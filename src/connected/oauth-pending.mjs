/**
 * Pending PKCE sessions for gateway-integrated OAuth callback (P5).
 * In-memory + optional disk so CLI and gateway can share on same host.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const mem = new Map();

function pendingPath(cfg) {
  const base = cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw");
  return path.join(base, "oauth-pending.json");
}

export async function createPending(cfg, record) {
  const id = record.state || crypto.randomBytes(16).toString("hex");
  const entry = {
    ...record,
    state: id,
    createdAt: Date.now(),
    expiresAt: Date.now() + (record.ttlMs || 180_000),
  };
  mem.set(id, entry);
  try {
    const fp = pendingPath(cfg);
    let all = {};
    try {
      all = JSON.parse(await fs.readFile(fp, "utf8"));
    } catch {
      all = {};
    }
    all[id] = entry;
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, JSON.stringify(all, null, 2), { mode: 0o600 });
  } catch {
    /* mem only */
  }
  return entry;
}

export async function takePending(cfg, state) {
  let entry = mem.get(state);
  mem.delete(state);
  try {
    const fp = pendingPath(cfg);
    const all = JSON.parse(await fs.readFile(fp, "utf8"));
    if (!entry) entry = all[state];
    if (all[state]) {
      delete all[state];
      await fs.writeFile(fp, JSON.stringify(all, null, 2));
    }
  } catch {
    /* */
  }
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) return null;
  return entry;
}
