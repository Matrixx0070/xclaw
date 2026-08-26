/**
 * Control-plane file (~/.xclaw/state/control.sqlite).
 *
 * Pairing-only slice (spec §11.4 + §11.11 + §11.16): open via the query kit,
 * refuse a newer schema_meta.version, refuse a v1 file that is missing a
 * stable table, cache one handle per process. Absorb of pairing.json is
 * explicit (same shape as cron JSON → ledger) and is NOT run from open —
 * live telegram/discord still read ~/.xclaw/pairing.json through
 * createPairingStore. Do not fold cron payload jobs into this file.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openKit } from "../persist/query-kit.mjs";

export const CONTROL_SCHEMA_VERSION = 1;

const CONTROL_TABLES = [
  "schema_meta",
  "pair_pending",
  "pair_done",
  "devices",
  "delivery_queue",
  "task_runs",
  "transcript_events",
];

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

export function assertControlShape(db) {
  const names = tableNames(db);
  const missing = CONTROL_TABLES.filter((n) => !names.includes(n));
  if (missing.length) {
    throw refuse(
      "XCLAW_SCHEMA_INCOMPLETE",
      `control plane missing tables: ${missing.join(", ")}`,
    );
  }
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

export function openControlPlane(cfg) {
  const file = controlPlaneFile(cfg);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const kit = openKit(file, { label: "control plane" });
  try {
    const ver = readSchemaVersion(kit.db);
    if (ver != null && ver > CONTROL_SCHEMA_VERSION) {
      throw refuse(
        "XCLAW_SCHEMA_NEWER",
        `control plane schema ${ver} is newer than ${CONTROL_SCHEMA_VERSION}; upgrade the gateway binary`,
      );
    }
    if (ver != null && ver < CONTROL_SCHEMA_VERSION) {
      throw refuse(
        "XCLAW_SCHEMA_OLDER",
        `control plane schema ${ver} is older than ${CONTROL_SCHEMA_VERSION}; no bump in this binary`,
      );
    }
    if (ver === CONTROL_SCHEMA_VERSION) {
      assertControlShape(kit.db);
      kit.atomic(() => stampSchema(kit, { writeVersion: false }));
    } else if (tableNames(kit.db).length > 0) {
      assertControlShape(kit.db);
    } else {
      kit.exec(DDL);
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
    throw err;
  }
}

let plane = null;

export function getControlPlane(cfg) {
  if (!plane) plane = openControlPlane(cfg);
  return plane;
}

export function stopControlPlane() {
  try {
    plane?.close();
  } catch {
    /* already closed */
  }
  plane = null;
}
