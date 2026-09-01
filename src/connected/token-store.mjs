/**
 * Connected-app token store — connected-tokens.json in the config dir.
 * Optional AES-256-GCM when XCLAW_TOKEN_STORE_KEY or gateway token present.
 *
 * connected-tokens.json belongs to the config dir that owns the instance, not
 * to whoever's home dir the process happens to run under. Resolving it from
 * `os.homedir()` alone meant two instances on one host shared a single
 * token store, so instance B's connected apps used instance A's tokens —
 * and the suite wrote into the operator's real `~/.xclaw/connected-tokens.json`.
 *
 * Production writers (`setAppToken(cfg)` at oauth-callback / oauth-login)
 * already had cfg in scope. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null` rather than guessing at the home
 * dir. Same shape as `storePath` in mcp/oauth. Honour existing
 * `XCLAW_CONFIG_DIR`. `saveTokens` no-ops a null path (do not `mkdir(null)` /
 * `path.dirname(null)`). `loadTokens` returns `{ version: 1, apps: {} }`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  resolveStoreKey,
  encryptJson,
  decryptJson,
  isEncryptedStore,
} from "./token-crypto.mjs";

/**
 * Honour `paths.configDir` then `XCLAW_CONFIG_DIR` then null.
 * No home fallback.
 */
export function storePath(cfg = {}) {
  const dir = cfg?.paths?.configDir || process.env.XCLAW_CONFIG_DIR;
  return dir ? path.join(dir, "connected-tokens.json") : null;
}

export async function loadTokens(cfg) {
  const fp = storePath(cfg);
  if (!fp) return { version: 1, apps: {} };
  try {
    const raw = await fs.readFile(fp, "utf8");
    const parsed = JSON.parse(raw);
    if (isEncryptedStore(parsed)) {
      const key = resolveStoreKey(cfg);
      if (!key) {
        throw new Error(
          "Token store is encrypted but XCLAW_TOKEN_STORE_KEY / XCLAW_GATEWAY_TOKEN not set"
        );
      }
      return decryptJson(parsed, key);
    }
    return parsed;
  } catch (e) {
    if (e.code === "ENOENT") return { version: 1, apps: {} };
    if (String(e.message || "").includes("encrypted")) throw e;
    return { version: 1, apps: {} };
  }
}

export async function saveTokens(cfg, data) {
  const fp = storePath(cfg);
  if (!fp) return null;
  await fs.mkdir(path.dirname(fp), { recursive: true });
  const key = resolveStoreKey(cfg);
  const payload = key ? encryptJson(data, key) : data;
  await fs.writeFile(fp, JSON.stringify(payload, null, 2), { mode: 0o600 });
  try {
    await fs.chmod(fp, 0o600);
  } catch {
    /* */
  }
  return fp;
}

export async function setAppToken(cfg, appId, tokenRecord) {
  const data = await loadTokens(cfg);
  data.apps = data.apps || {};
  data.apps[appId] = {
    ...tokenRecord,
    updatedAt: new Date().toISOString(),
  };
  await saveTokens(cfg, data);
  return data.apps[appId];
}

export async function getAppToken(cfg, appId) {
  const data = await loadTokens(cfg);
  return data.apps?.[appId] || null;
}

export async function deleteAppToken(cfg, appId) {
  const data = await loadTokens(cfg);
  if (!data.apps?.[appId]) return { ok: true, deleted: false };
  delete data.apps[appId];
  await saveTokens(cfg, data);
  return { ok: true, deleted: true, appId };
}

export async function listConnectedApps(cfg) {
  const data = await loadTokens(cfg);
  return Object.entries(data.apps || {}).map(([id, v]) => ({
    id,
    hasToken: Boolean(v.accessToken || v.token),
    hasRefreshToken: Boolean(v.refreshToken),
    expiresAt: v.expiresAt || null,
    updatedAt: v.updatedAt,
    source: v.source,
    scopes: v.scopes || v.scope || [],
    invalidatedAt: v.invalidatedAt || null,
  }));
}
