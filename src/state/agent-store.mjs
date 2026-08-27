/**
 * Per-agent file (spec §11.13).
 *
 * Control plane stays global. Heavy session text can move to
 * ~/.xclaw/agents/<id>/agent.sqlite with the same kit + WAL keeper.
 * Do not open one handle per request; cache by agent id and close on
 * gateway stop. Do not open from gateway start — a get creates the
 * file. Do not move live transcripts onto this file in this binary.
 * Do not bump CONTROL_SCHEMA_VERSION. Do not absorb pairing.json.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openKit } from "../persist/query-kit.mjs";
import { isSqlCorruptionError } from "../persist/atomic-work.mjs";
import { quarantineSqlFile } from "../persist/sql-quarantine.mjs";

const DDL = `
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
  let kit;
  try {
    kit = openKit(file, { label: `agent store ${id}` });
  } catch (err) {
    quarantineCorrupt(file, err);
    throw err;
  }
  try {
    kit.exec(DDL);
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
