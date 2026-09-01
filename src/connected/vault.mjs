/**
 * Multi-user connected token vault (P6).
 * Paths: <configDir>/vault/<userId>/connected-tokens.json
 * Default user: "default" (legacy store still works via token-store).
 *
 * The vault belongs to the config dir that owns the instance, not to
 * whoever's home dir the process happens to run under. Resolving it from
 * `os.homedir()` alone meant two instances on one host shared a single
 * vault, so instance B's linked accounts used instance A's tokens —
 * and the suite wrote into the operator's real `~/.xclaw/vault/`.
 *
 * Production writers (`vaultMergeIntoAccount(cfg)` at account-links,
 * `vaultDeleteApp(cfg)` at auth-legacy-cli) already had cfg in scope.
 * `loadConfig()` stamps `paths.configDir` unconditionally
 * (config/load.mjs:187), so a cfg without one is never a real caller.
 * Such a path is `null` rather than guessing at the home dir. Same
 * shape as `storePath` in connected/token-store. Honour existing
 * `XCLAW_CONFIG_DIR`. `vaultSave` no-ops a null path (do not
 * `mkdir(null)` / `path.dirname(null)` / rename `"null.bak-*"`).
 * `vaultLoad` returns `{ version: 1, apps: {}, userId }`.
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
export function vaultRoot(cfg = {}) {
  const dir = cfg?.paths?.configDir || process.env.XCLAW_CONFIG_DIR;
  return dir ? path.join(dir, "vault") : null;
}

function userDir(cfg, userId) {
  const root = vaultRoot(cfg);
  if (!root) return null;
  const id = String(userId || "default").replace(/[^\w.@+-]+/g, "_").slice(0, 128);
  return path.join(root, id);
}

function tokenPath(cfg, userId) {
  const dir = userDir(cfg, userId);
  return dir ? path.join(dir, "connected-tokens.json") : null;
}

async function readStore(fp, cfg) {
  try {
    const raw = await fs.readFile(fp, "utf8");
    const parsed = JSON.parse(raw);
    if (isEncryptedStore(parsed)) {
      const key = resolveStoreKey(cfg);
      if (!key) throw new Error("encrypted vault requires XCLAW_TOKEN_STORE_KEY");
      return decryptJson(parsed, key);
    }
    return parsed;
  } catch (e) {
    if (e.code === "ENOENT") return { version: 1, apps: {}, userId: null };
    throw e;
  }
}

async function writeStore(fp, cfg, data) {
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
}

export async function vaultListUsers(cfg) {
  const root = vaultRoot(cfg);
  if (!root) return [];
  try {
    const ents = await fs.readdir(root, { withFileTypes: true });
    return ents.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export async function vaultLoad(cfg, userId = "default") {
  const fp = tokenPath(cfg, userId);
  if (!fp) return { version: 1, apps: {}, userId };
  const data = await readStore(fp, cfg);
  data.userId = userId;
  return data;
}

export async function vaultSave(cfg, userId, data) {
  const fp = tokenPath(cfg, userId);
  if (!fp) return null;
  data.userId = userId;
  data.version = data.version || 1;
  await writeStore(fp, cfg, data);
  return fp;
}

export async function vaultGetApp(cfg, userId, appId) {
  const data = await vaultLoad(cfg, userId);
  return data.apps?.[appId] || null;
}

export async function vaultSetApp(cfg, userId, appId, record) {
  const data = await vaultLoad(cfg, userId);
  data.apps = data.apps || {};
  data.apps[appId] = { ...record, updatedAt: new Date().toISOString() };
  await vaultSave(cfg, userId, data);
  return data.apps[appId];
}

export async function vaultDeleteApp(cfg, userId, appId) {
  const data = await vaultLoad(cfg, userId);
  if (!data.apps?.[appId]) return { ok: true, deleted: false };
  delete data.apps[appId];
  await vaultSave(cfg, userId, data);
  return { ok: true, deleted: true, userId, appId };
}

export async function vaultListApps(cfg, userId) {
  const data = await vaultLoad(cfg, userId);
  return Object.entries(data.apps || {}).map(([id, v]) => ({
    id,
    userId,
    hasToken: Boolean(v.accessToken || v.token),
    hasRefreshToken: Boolean(v.refreshToken),
    expiresAt: v.expiresAt || null,
    updatedAt: v.updatedAt,
    source: v.source,
  }));
}

/**
 * Resolve token for user: vault user → legacy default store.
 */
export async function vaultResolveToken(cfg, appId, userId = "default") {
  if (userId && userId !== "default") {
    const rec = await vaultGetApp(cfg, userId, appId);
    if (rec?.accessToken || rec?.token) {
      return { accessToken: rec.accessToken || rec.token, source: "vault", userId, ...rec };
    }
  }
  const { getAppToken } = await import("./token-store.mjs");
  const legacy = await getAppToken(cfg, appId);
  if (legacy?.accessToken || legacy?.token) {
    return {
      accessToken: legacy.accessToken || legacy.token,
      source: "store",
      userId: "default",
      ...legacy,
    };
  }
  return null;
}

/**
 * Merge token apps from source vault keys into target account vault.
 * Per appId: keep the record with newer updatedAt (last-write-wins).
 * Source dirs are renamed to *.bak-<ts> after successful merge (not deleted).
 *
 * @param {object} cfg
 * @param {string} accountId  e.g. acc_…
 * @param {string[]} sourceKeys  identities or prior vault folder names
 * @returns {Promise<{ ok: boolean, merged: object, backedUp: string[], errors: string[] }>}
 */
export async function vaultMergeIntoAccount(cfg, accountId, sourceKeys = []) {
  const targetKey = String(accountId || "").trim();
  if (!targetKey) {
    return { ok: false, merged: {}, backedUp: [], errors: ["missing accountId"] };
  }

  const target = await vaultLoad(cfg, targetKey);
  target.apps = target.apps || {};
  const merged = {};
  const backedUp = [];
  const errors = [];
  const sources = [...new Set(sourceKeys.map(String).filter(Boolean))].filter(
    (k) => k !== targetKey && k !== "default"
  );

  for (const src of sources) {
    try {
      const data = await vaultLoad(cfg, src);
      const apps = data.apps || {};
      for (const [appId, rec] of Object.entries(apps)) {
        if (!rec || !(rec.accessToken || rec.token || rec.refreshToken)) continue;
        const existing = target.apps[appId];
        const srcTs = Date.parse(rec.updatedAt || rec.lastRefreshAt || 0) || 0;
        const dstTs = existing
          ? Date.parse(existing.updatedAt || existing.lastRefreshAt || 0) || 0
          : 0;
        if (!existing || srcTs >= dstTs) {
          target.apps[appId] = {
            ...rec,
            mergedFrom: src,
            mergedAt: new Date().toISOString(),
          };
          merged[appId] = { from: src, chose: "source" };
        } else {
          merged[appId] = { from: src, chose: "target" };
        }
      }

      // Backup source vault dir (best-effort)
      try {
        const dir = userDir(cfg, src);
        if (!dir) continue;
        const bak = `${dir}.bak-${Date.now()}`;
        await fs.rename(dir, bak);
        backedUp.push(bak);
      } catch (e) {
        if (e.code !== "ENOENT") errors.push(`${src}: backup ${e.message}`);
      }
    } catch (e) {
      errors.push(`${src}: ${e.message}`);
    }
  }

  target.userId = targetKey;
  target.version = target.version || 1;
  target.mergedAt = new Date().toISOString();
  await vaultSave(cfg, targetKey, target);

  return {
    ok: errors.length === 0,
    accountId: targetKey,
    apps: Object.keys(target.apps),
    merged,
    backedUp,
    errors,
  };
}
