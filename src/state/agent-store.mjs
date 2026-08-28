/**
 * Per-agent file (spec §11.13).
 *
 * Control plane stays global. Heavy session text can move to
 * ~/.xclaw/agents/<id>/agent.sqlite with the same kit + WAL keeper.
 * Do not open one handle per request; cache by agent id and close on
 * gateway stop. Do not open from gateway start — a get creates the
 * file. Do not move live transcripts onto this file in this binary.
 * Do not bump CONTROL_SCHEMA_VERSION. Do not absorb pairing.json.
 *
 * §12.6 VFS/artifacts/boards tables live on this file, not the control
 * plane. Additive CREATE IF NOT EXISTS — AGENT_SCHEMA_VERSION stays 1.
 * House DDL style (TEXT ISO timestamps, no STRICT), matching the rest
 * of this file — deviation from the spec's STRICT + INTEGER ms.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openKit } from "../persist/query-kit.mjs";
import { isSqlCorruptionError } from "../persist/atomic-work.mjs";
import { quarantineSqlFile, refuseNotADatabase } from "../persist/sql-quarantine.mjs";

/** Agent schema version marker (spec §12.10). */
export const AGENT_SCHEMA_VERSION = 1;

const DDL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  touched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transcript_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS transcript_session ON transcript_events(session_key, seq);
CREATE TABLE IF NOT EXISTS session_heads (
  session_key TEXT PRIMARY KEY,
  agent TEXT,
  last_seq INTEGER NOT NULL,
  touched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_vfs_nodes (
  path TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT,
  bytes BLOB,
  touched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_artifacts (
  id TEXT PRIMARY KEY,
  session_key TEXT,
  kind TEXT NOT NULL,
  path TEXT,
  payload TEXT,
  touched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_boards (
  id TEXT PRIMARY KEY,
  title TEXT,
  payload TEXT NOT NULL,
  touched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_board_columns (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  title TEXT,
  position INTEGER NOT NULL,
  payload TEXT,
  touched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_board_cards (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  column_id TEXT,
  title TEXT,
  payload TEXT,
  touched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_transcript_archive (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_heartbeat_outcomes (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  at TEXT NOT NULL
);
`;

function agentIdKey(agentId) {
  const id = String(agentId ?? "");
  if (!id || id === "." || id === ".." || /[\\/]/.test(id)) {
    throw new Error("invalid agent id");
  }
  return id;
}

export function agentStoreFile(agentId, cfg) {
  const id = agentIdKey(agentId);
  const root = cfg?.paths?.agentDir || path.join(os.homedir(), ".xclaw", "agents");
  return path.join(root, id, "agent.sqlite");
}

/**
 * Spec §12.10: insert the marker once; a reopen only touches touched_at
 * (version is never bumped in place). Refusing a NEWER stored version is
 * extra vs the spec sketch — mirrors the control-plane fail-closed gate.
 */
function markAgentSchema(kit) {
  kit.atomic(() => {
    const row = kit.prepare("SELECT version FROM schema_meta WHERE key = 'agent'").get();
    if (row && row.version > AGENT_SCHEMA_VERSION) {
      throw new Error(
        `agent store schema ${row.version} is newer than ${AGENT_SCHEMA_VERSION}; upgrade the gateway binary`,
      );
    }
    kit
      .prepare(
        "INSERT INTO schema_meta(key, version, touched_at) VALUES ('agent', ?, ?) ON CONFLICT(key) DO UPDATE SET touched_at = excluded.touched_at",
      )
      .run(AGENT_SCHEMA_VERSION, new Date().toISOString());
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

export function openAgentStore(agentId, cfg) {
  const id = agentIdKey(agentId);
  const file = agentStoreFile(id, cfg);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  refuseNotADatabase(file);
  let kit;
  try {
    kit = openKit(file, { label: `agent store ${id}` });
  } catch (err) {
    quarantineCorrupt(file, err);
    throw err;
  }
  try {
    kit.exec(DDL);
    markAgentSchema(kit);
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

const stores = new Map();

export function getAgentStore(agentId, cfg) {
  const id = agentIdKey(agentId);
  const hit = stores.get(id);
  if (hit) return hit;
  const kit = openAgentStore(id, cfg);
  stores.set(id, kit);
  return kit;
}

export function stopAgentStores() {
  for (const kit of stores.values()) {
    try {
      kit.close();
    } catch {
      /* already closed */
    }
  }
  stores.clear();
}
