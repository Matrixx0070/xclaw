/**
 * Control-plane file (~/.xclaw/state/control.sqlite).
 *
 * Pairing slice (spec §11.4 + §11.11 + §11.16) plus later groups (spec §11.7):
 * open via the query kit, refuse a newer schema_meta.version, refuse a
 * current-version file that is missing a stable table, migrate v1 → v2 by
 * CREATE TABLE IF NOT EXISTS only (never DROP a populated table to "fix"
 * a mismatch). Absorb of pairing.json is explicit and is NOT run from open
 * — live telegram/discord still read ~/.xclaw/pairing.json through
 * createPairingStore. First-open of a missing file takes the same exclusive
 * coordinator as cron import (spec §11.24) then drops it before the kit
 * open — BEGIN EXCLUSIVE on the coordinator handle blocks a second
 * DatabaseSync. After the file exists, later opens skip the lock. Delivery
 * queue helpers (spec §11.22) and task run helpers (spec §11.23) sit on an
 * open kit and are not wired to live outbound or the live runner. Do not
 * fold cron payload jobs into this file. Do not absorb seats/approvals/
 * plugin JSON in this binary.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openKit } from "../persist/query-kit.mjs";
import { tryTakeExclusiveLock } from "../persist/engine-load.mjs";
import { isSqlCorruptionError } from "../persist/atomic-work.mjs";
import { quarantineSqlFile } from "../persist/sql-quarantine.mjs";

export const CONTROL_SCHEMA_VERSION = 2;

/** Tables present from v1. A v1 file missing one of these is incomplete. */
const V1_TABLES = [
  "schema_meta",
  "pair_pending",
  "pair_done",
  "devices",
  "delivery_queue",
  "task_runs",
  "transcript_events",
];

/** Extra group (spec §11.7). Added on v1→v2; required at v2. */
const V2_TABLES = [
  "state_leases",
  "operator_approvals",
  "plugin_state",
  "plugin_blobs",
  "audit_events",
  "session_heads",
];

const CONTROL_TABLES = [...V1_TABLES, ...V2_TABLES];

const DDL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  touched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pair_pending (
  id TEXT PRIMARY KEY,
  device TEXT,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pair_done (
  id TEXT PRIMARY KEY,
  device TEXT,
  payload TEXT NOT NULL,
  paired_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  role TEXT,
  token_hash TEXT,
  scopes TEXT,
  payload TEXT NOT NULL,
  touched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS delivery_queue (
  id TEXT PRIMARY KEY,
  queue TEXT NOT NULL,
  status TEXT NOT NULL,
  session_id TEXT,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS transcript_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS transcript_session ON transcript_events(session_key, seq);
`;

const V2_DDL = `
CREATE TABLE IF NOT EXISTS state_leases (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  owner TEXT,
  payload TEXT NOT NULL,
  expires_at TEXT,
  touched_at TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);
CREATE TABLE IF NOT EXISTS operator_approvals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE TABLE IF NOT EXISTS plugin_state (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  payload TEXT NOT NULL,
  touched_at TEXT NOT NULL,
  PRIMARY KEY (namespace, key)
);
CREATE TABLE IF NOT EXISTS plugin_blobs (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  meta TEXT,
  blob BLOB,
  touched_at TEXT NOT NULL,
  PRIMARY KEY (namespace, key)
);
CREATE TABLE IF NOT EXISTS audit_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT,
  payload TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_heads (
  session_key TEXT PRIMARY KEY,
  agent TEXT,
  last_seq INTEGER NOT NULL,
  touched_at TEXT NOT NULL
);
`;

function refuse(code, text) {
  const err = new Error(text);
  err.code = code;
  return err;
}

function tableNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);
}

export function controlPlaneFile(cfg) {
  if (cfg?.paths?.controlPlaneFile) return cfg.paths.controlPlaneFile;
  if (process.env.XCLAW_CONTROL_PLANE_FILE) return process.env.XCLAW_CONTROL_PLANE_FILE;
  const root = cfg?.paths?.stateDir || path.join(os.homedir(), ".xclaw", "state");
  return path.join(root, "control.sqlite");
}

export function pairingJsonFile(cfg) {
  return (
    cfg?.paths?.pairingFile ||
    process.env.XCLAW_PAIRING_FILE ||
    path.join(os.homedir(), ".xclaw", "pairing.json")
  );
}

export function readSchemaVersion(db, key = "control") {
  try {
    const row = db.prepare("SELECT version FROM schema_meta WHERE key = ?").get(key);
    return row ? Number(row.version) : null;
  } catch {
    return null;
  }
}

function assertTables(db, tables) {
  const names = tableNames(db);
  const missing = tables.filter((n) => !names.includes(n));
  if (missing.length) {
    throw refuse(
      "XCLAW_SCHEMA_INCOMPLETE",
      `control plane missing tables: ${missing.join(", ")}`,
    );
  }
}

export function assertControlShape(db) {
  assertTables(db, CONTROL_TABLES);
}

function migrateV1ToV2(kit) {
  assertTables(kit.db, V1_TABLES);
  kit.atomic(() => {
    kit.exec(V2_DDL);
    const now = new Date().toISOString();
    kit
      .prepare("UPDATE schema_meta SET version = ?, touched_at = ? WHERE key = ?")
      .run(CONTROL_SCHEMA_VERSION, now, "control");
  });
  assertControlShape(kit.db);
}

export function foldSidecars(db) {
  try {
    db.exec("PRAGMA wal_checkpoint(PASSIVE)");
  } catch {
    /* leftover -wal is best-effort */
  }
}

function stampSchema(kit, { writeVersion }) {
  const now = new Date().toISOString();
  if (writeVersion) {
    kit
      .prepare(
        "INSERT INTO schema_meta(key, version, touched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET touched_at = excluded.touched_at",
      )
      .run("control", CONTROL_SCHEMA_VERSION, now);
    return;
  }
  kit.prepare("UPDATE schema_meta SET touched_at = ? WHERE key = ?").run(now, "control");
}

export function absorbPairingJson(kit, jsonPath) {
  if (!jsonPath || !fs.existsSync(jsonPath)) return { moved: 0 };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } catch {
    return { moved: 0, error: "unreadable_json" };
  }
  const channels =
    parsed?.channels && typeof parsed.channels === "object" ? parsed.channels : null;
  if (!channels) return { moved: 0, error: "unreadable_json" };

  const writePending = kit.prepare(
    `INSERT INTO pair_pending(id, device, payload, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       device = excluded.device,
       payload = excluded.payload,
       created_at = excluded.created_at`,
  );
  const writeDone = kit.prepare(
    `INSERT INTO pair_done(id, device, payload, paired_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       device = excluded.device,
       payload = excluded.payload,
       paired_at = excluded.paired_at`,
  );

  let moved = 0;
  kit.atomic(() => {
    for (const [channel, st] of Object.entries(channels)) {
      for (const row of Array.isArray(st?.pending) ? st.pending : []) {
        if (!row?.id) continue;
        writePending.run(
          `${channel}:${row.id}`,
          channel,
          JSON.stringify(row),
          row.createdAt || new Date().toISOString(),
        );
        moved += 1;
      }
      for (const row of Array.isArray(st?.approved) ? st.approved : []) {
        if (!row?.id) continue;
        writeDone.run(
          `${channel}:${row.id}`,
          channel,
          JSON.stringify(row),
          row.approvedAt || new Date().toISOString(),
        );
        moved += 1;
      }
    }
  });
  if (moved > 0) {
    try {
      fs.renameSync(jsonPath, `${jsonPath}.bak`);
    } catch {
      /* keep original if rename denied */
    }
  }
  return { moved };
}

/**
 * Delivery queue helpers (spec §11.22).
 *
 * Sit on an open kit. Do not replace the live WS/telegram outbound path
 * in this binary. takeDelivery SELECT+UPDATE is one atomic unit so two
 * callers cannot claim the same pending row.
 */
export function enqueueDelivery(kit, { id, queue, sessionId, payload }) {
  const now = new Date().toISOString();
  kit.atomic(() => {
    kit
      .prepare(
        `INSERT INTO delivery_queue(id, queue, status, session_id, payload, created_at, updated_at)
         VALUES (?, ?, 'pending', ?, ?, ?, ?)`,
      )
      .run(id, queue, sessionId || null, JSON.stringify(payload || {}), now, now);
  });
}

export function takeDelivery(kit, queue) {
  return kit.atomic(() => {
    const row = kit
      .prepare(
        `SELECT * FROM delivery_queue WHERE queue = ? AND status = 'pending' ORDER BY created_at LIMIT 1`,
      )
      .get(queue);
    if (!row) return null;
    kit
      .prepare("UPDATE delivery_queue SET status = 'inflight', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), row.id);
    return row;
  });
}

export function finishDelivery(kit, id, status = "done") {
  kit
    .prepare("UPDATE delivery_queue SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, new Date().toISOString(), id);
}

/**
 * Task run helpers (spec §11.23).
 *
 * Sit on an open kit. Do not replace the live runner in this binary.
 * finishTask merges extra onto the stored payload JSON so callers can
 * attach a result without dropping the start payload.
 */
export function startTask(kit, { id, payload }) {
  kit
    .prepare(
      `INSERT INTO task_runs(id, status, payload, started_at) VALUES (?, 'running', ?, ?)`,
    )
    .run(id, JSON.stringify(payload || {}), new Date().toISOString());
}

export function finishTask(kit, id, status, extra = {}) {
  kit.atomic(() => {
    const prev = kit.prepare("SELECT payload FROM task_runs WHERE id = ?").get(id);
    const body = { ...(prev ? JSON.parse(prev.payload) : {}), ...extra };
    kit
      .prepare("UPDATE task_runs SET status = ?, payload = ?, finished_at = ? WHERE id = ?")
      .run(status, JSON.stringify(body), new Date().toISOString(), id);
  });
}

function quarantineCorrupt(file, err) {
  if (!isSqlCorruptionError(err)) return;
  try {
    quarantineSqlFile(file);
  } catch {
    /* copy is best-effort; still refuse the open */
  }
}

export function openControlPlane(cfg) {
  const file = controlPlaneFile(cfg);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let kit;
  try {
    kit = openKit(file, { label: "control plane" });
  } catch (err) {
    quarantineCorrupt(file, err);
    throw err;
  }
  try {
    const ver = readSchemaVersion(kit.db);
    if (ver != null && ver > CONTROL_SCHEMA_VERSION) {
      throw refuse(
        "XCLAW_SCHEMA_NEWER",
        `control plane schema ${ver} is newer than ${CONTROL_SCHEMA_VERSION}; upgrade the gateway binary`,
      );
    }
    if (ver === 1) {
      migrateV1ToV2(kit);
    } else if (ver != null && ver < CONTROL_SCHEMA_VERSION) {
      throw refuse(
        "XCLAW_SCHEMA_OLDER",
        `control plane schema ${ver} is older than ${CONTROL_SCHEMA_VERSION}; no bump in this binary`,
      );
    } else if (ver === CONTROL_SCHEMA_VERSION) {
      assertControlShape(kit.db);
      kit.atomic(() => stampSchema(kit, { writeVersion: false }));
    } else if (tableNames(kit.db).length > 0) {
      assertControlShape(kit.db);
    } else {
      kit.exec(DDL);
      kit.exec(V2_DDL);
      kit.atomic(() => stampSchema(kit, { writeVersion: true }));
    }
    foldSidecars(kit.db);
    return kit;
  } catch (err) {
    try {
      kit.close();
    } catch {
      /* still throw the original refuse */
    }
    quarantineCorrupt(file, err);
    throw err;
  }
}

/**
 * First-open exclusive lock (spec §11.24).
 *
 * Same coordinator as cron import. Use when doctor --fix and gateway start
 * might both create control.sqlite. After the file exists, later opens skip
 * the exclusive lock and just use the process cache in 11.16.
 *
 * BEGIN EXCLUSIVE on the coordinator handle blocks a second DatabaseSync, so
 * the lock is dropped before openControlPlane. The take still serializes
 * empty-file creation; the kit then uses its own busy_timeout for DDL.
 */
export function openControlPlaneExclusive(cfg) {
  const file = controlPlaneFile(cfg);
  if (fs.existsSync(file)) return openControlPlane(cfg);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = tryTakeExclusiveLock(file, { waitMs: 1000 });
  try {
    lock?.drop?.();
  } catch {
    /* coordinator released */
  }
  return openControlPlane(cfg);
}

let plane = null;
let planeFailed = null;

export function getControlPlane(cfg) {
  if (planeFailed) throw planeFailed;
  if (!plane) {
    try {
      plane = openControlPlaneExclusive(cfg);
    } catch (err) {
      if (isSqlCorruptionError(err)) planeFailed = err;
      throw err;
    }
  }
  return plane;
}

export function stopControlPlane() {
  try {
    plane?.close();
  } catch {
    /* already closed */
  }
  plane = null;
  planeFailed = null;
}
