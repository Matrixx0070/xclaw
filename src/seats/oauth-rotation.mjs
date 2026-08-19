/**
 * Seat OAuth refresh rotation + reuse detection (durable).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const seenRefreshTokens = new Map();
let loaded = false;

export function rotationRegistryPath(cfg = {}) {
  const base =
    cfg.paths?.configDir ||
    process.env.XCLAW_CONFIG_DIR ||
    path.join(os.homedir(), ".xclaw");
  return path.join(base, "oauth-refresh-registry.json");
}

function loadRegistry(cfg = {}) {
  if (loaded) return;
  loaded = true;
  try {
    const raw = fs.readFileSync(rotationRegistryPath(cfg), "utf8");
    const j = JSON.parse(raw);
    for (const [k, v] of Object.entries(j.tokens || {})) {
      seenRefreshTokens.set(k, v);
    }
  } catch {
    /* first run */
  }
}

function saveRegistry(cfg = {}) {
  try {
    const fp = rotationRegistryPath(cfg);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const tmp = fp + ".tmp";
    const tokens = Object.fromEntries(seenRefreshTokens.entries());
    fs.writeFileSync(tmp, JSON.stringify({ at: new Date().toISOString(), tokens }, null, 2));
    fs.renameSync(tmp, fp);
  } catch {
    /* best effort */
  }
}

export function hashToken(token) {
  if (!token) return null;
  let h = 0;
  const s = String(token);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

export function recordRefreshUse(token, { rotatedFrom = null, cfg = {} } = {}) {
  loadRegistry(cfg);
  const id = hashToken(token);
  if (!id) return { ok: false, reason: "empty_token" };
  const prev = seenRefreshTokens.get(id);
  if (prev && !prev.retired) {
    return { ok: false, reused: true, reason: "refresh_token_reuse" };
  }
  seenRefreshTokens.set(id, { at: Date.now(), rotatedFrom: hashToken(rotatedFrom) });
  if (rotatedFrom) {
    const old = hashToken(rotatedFrom);
    if (old) seenRefreshTokens.set(old, { at: Date.now(), retired: true });
  }
  saveRegistry(cfg);
  return { ok: true, reused: false, id };
}

export function clearRefreshRegistry(cfg = {}) {
  seenRefreshTokens.clear();
  loaded = false;
  try {
    fs.unlinkSync(rotationRegistryPath(cfg));
  } catch {
    /* */
  }
}

export default { hashToken, recordRefreshUse, clearRefreshRegistry, rotationRegistryPath };
