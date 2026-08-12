/**
 * Connected-app token store — ~/.xclaw/connected-tokens.json
 * Optional AES-256-GCM when XCLAW_TOKEN_STORE_KEY or gateway token present.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  resolveStoreKey,
  encryptJson,
  decryptJson,
  isEncryptedStore,
} from "./token-crypto.mjs";

function storePath(cfg) {
  const base = cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw");
  return path.join(base, "connected-tokens.json");
}

export async function loadTokens(cfg) {
  try {
    const raw = await fs.readFile(storePath(cfg), "utf8");
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
