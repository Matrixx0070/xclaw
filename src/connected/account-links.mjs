/**
 * Account linking L1 — identity → account map + normalizeChannelUserId.
 *
 * Identity: "slack:U01ABC", "telegram:123", "discord:99", "email:a@b.c"
 * Account:  "acc_<id>" shared vault key after link
 *
 * Store: ~/.xclaw/accounts/links.json
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const STORE_VERSION = 1;

function accountsDir(cfg) {
  const base = cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw");
  return path.join(base, "accounts");
}

function linksPath(cfg) {
  return path.join(accountsDir(cfg), "links.json");
}

/**
 * Normalize a channel-native user id into a stable identity key.
 * @param {{ channel?: string, userId?: string|number|null, chatId?: string|number|null }} opts
 * @returns {string} e.g. "telegram:123456" or "default"
 */
export function normalizeChannelUserId(opts = {}) {
  const ch = String(opts.channel || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, "");
  let raw =
    opts.userId != null && String(opts.userId).trim() !== ""
      ? String(opts.userId).trim()
      : null;

  if (!raw) return "default";

  // Already compound?
  if (raw.includes(":")) {
    const [prefix, ...rest] = raw.split(":");
    const idPart = rest.join(":").trim();
    if (!idPart) return "default";
    const p = prefix.toLowerCase().replace(/[^a-z0-9_]+/g, "") || "unknown";
    if (p === "email") return `email:${idPart.toLowerCase()}`;
    return `${p}:${idPart}`;
  }

  const channel = ch || "unknown";
  if (channel === "email") return `email:${raw.toLowerCase()}`;
  return `${channel}:${raw}`;
}

function emptyStore() {
  return { version: STORE_VERSION, links: {}, accounts: {} };
}

export async function loadAccountStore(cfg) {
  try {
    const raw = await fs.readFile(linksPath(cfg), "utf8");
    const data = JSON.parse(raw);
    if (!data.links) data.links = {};
    if (!data.accounts) data.accounts = {};
    data.version = data.version || STORE_VERSION;
    return data;
  } catch (e) {
    if (e.code === "ENOENT") return emptyStore();
    throw e;
  }
}

export async function saveAccountStore(cfg, data) {
  const dir = accountsDir(cfg);
  await fs.mkdir(dir, { recursive: true });
  const fp = linksPath(cfg);
  await fs.writeFile(fp, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    await fs.chmod(fp, 0o600);
  } catch {
    /* */
  }
  return fp;
}

function newAccountId() {
  return `acc_${crypto.randomBytes(12).toString("hex")}`;
}

/**
 * @returns {string|null}
 */
export async function resolveAccountId(cfg, identity) {
  if (!identity || identity === "default") return null;
  const store = await loadAccountStore(cfg);
  return store.links[identity] || null;
}

/**
 * Vault key: linked account id, or identity, or default.
 */
export async function resolveVaultUserId(cfg, { channel, userId, chatId } = {}) {
  const identity = normalizeChannelUserId({ channel, userId, chatId });
  if (identity === "default") return "default";
  const accountId = await resolveAccountId(cfg, identity);
  return accountId || identity;
}

export async function createAccount(cfg, { primaryIdentity, label } = {}) {
  const store = await loadAccountStore(cfg);
  const id = newAccountId();
  const identities = [];
  if (primaryIdentity) {
    const norm = normalizeChannelUserId(
      primaryIdentity.includes(":")
        ? { userId: primaryIdentity }
        : { channel: "unknown", userId: primaryIdentity }
    );
    if (norm !== "default") {
      if (store.links[norm] && store.links[norm] !== id) {
        return {
          ok: false,
          error: `identity already linked to ${store.links[norm]}`,
          identity: norm,
        };
      }
      identities.push(norm);
      store.links[norm] = id;
    }
  }
  store.accounts[id] = {
    id,
    label: label || null,
    primary: identities[0] || null,
    identities,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveAccountStore(cfg, store);
  return { ok: true, account: store.accounts[id] };
}

/**
 * Link an identity to an account (create account if needed).
 */
export async function linkIdentity(cfg, identityInput, accountId = null) {
  const identity = normalizeChannelUserId(
    identityInput.includes(":")
      ? { userId: identityInput }
      : { channel: "unknown", userId: identityInput }
  );
  if (identity === "default") {
    return { ok: false, error: "cannot link default identity" };
  }

  const store = await loadAccountStore(cfg);
  const existing = store.links[identity];
  if (existing && accountId && existing !== accountId) {
    return {
      ok: false,
      error: `identity ${identity} already linked to ${existing}`,
      code: "already_linked",
    };
  }
  if (existing && !accountId) {
    return { ok: true, accountId: existing, identity, already: true };
  }

  let accId = accountId;
  if (!accId) {
    accId = newAccountId();
    store.accounts[accId] = {
      id: accId,
      label: null,
      primary: identity,
      identities: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  if (!store.accounts[accId]) {
    return { ok: false, error: `unknown account ${accId}` };
  }

  store.links[identity] = accId;
  const acc = store.accounts[accId];
  if (!acc.identities.includes(identity)) acc.identities.push(identity);
  if (!acc.primary) acc.primary = identity;
  acc.updatedAt = new Date().toISOString();
  await saveAccountStore(cfg, store);
  return { ok: true, accountId: accId, identity, account: acc };
}

/**
 * Link two identities to the same account.
 * Prefer fromIdentity's account if it exists.
 */
export async function linkIdentities(cfg, fromIdentity, toIdentity) {
  const from = normalizeChannelUserId(
    fromIdentity.includes(":")
      ? { userId: fromIdentity }
      : { channel: "unknown", userId: fromIdentity }
  );
  const to = normalizeChannelUserId(
    toIdentity.includes(":")
      ? { userId: toIdentity }
      : { channel: "unknown", userId: toIdentity }
  );
  if (from === "default" || to === "default") {
    return { ok: false, error: "invalid identity" };
  }
  if (from === to) {
    return { ok: false, error: "identities are identical" };
  }

  const store = await loadAccountStore(cfg);
  const fromAcc = store.links[from];
  const toAcc = store.links[to];

  if (fromAcc && toAcc && fromAcc !== toAcc) {
    return {
      ok: false,
      error: `both already linked to different accounts (${fromAcc} vs ${toAcc}); unlink one first`,
      code: "conflict",
    };
  }

  let accountId = fromAcc || toAcc;
  if (!accountId) {
    const created = await createAccount(cfg, { primaryIdentity: from });
    if (!created.ok) return created;
    accountId = created.account.id;
  }

  const r1 = await linkIdentity(cfg, from, accountId);
  if (!r1.ok) return r1;
  const r2 = await linkIdentity(cfg, to, accountId);
  if (!r2.ok) return r2;

  let vaultMerge = null;
  try {
    const { vaultMergeIntoAccount } = await import("./vault.mjs");
    vaultMerge = await vaultMergeIntoAccount(cfg, accountId, [from, to]);
  } catch (e) {
    vaultMerge = { ok: false, errors: [e.message] };
  }

  return {
    ok: true,
    accountId,
    identities: [from, to],
    account: (await loadAccountStore(cfg)).accounts[accountId],
    vaultMerge,
  };
}

export async function unlinkIdentity(cfg, identityInput) {
  const identity = normalizeChannelUserId(
    identityInput.includes(":")
      ? { userId: identityInput }
      : { channel: "unknown", userId: identityInput }
  );
  const store = await loadAccountStore(cfg);
  const accId = store.links[identity];
  if (!accId) return { ok: true, deleted: false, identity };
  delete store.links[identity];
  const acc = store.accounts[accId];
  if (acc) {
    acc.identities = (acc.identities || []).filter((i) => i !== identity);
    if (acc.primary === identity) acc.primary = acc.identities[0] || null;
    acc.updatedAt = new Date().toISOString();
    if (!acc.identities.length) delete store.accounts[accId];
  }
  await saveAccountStore(cfg, store);
  return { ok: true, deleted: true, identity, accountId: accId };
}

export async function listAccounts(cfg) {
  const store = await loadAccountStore(cfg);
  return {
    accounts: Object.values(store.accounts),
    links: store.links,
  };
}

export async function getAccount(cfg, accountId) {
  const store = await loadAccountStore(cfg);
  return store.accounts[accountId] || null;
}

/** @type {Map<string, { identity: string, accountId: string|null, expiresAt: number }>} */
const pairingMem = new Map();

function pairingPath(cfg) {
  return path.join(accountsDir(cfg), "pairing.json");
}

async function loadPairing(cfg) {
  try {
    const raw = await fs.readFile(pairingPath(cfg), "utf8");
    return JSON.parse(raw);
  } catch {
    return { codes: {} };
  }
}

async function savePairing(cfg, data) {
  await fs.mkdir(accountsDir(cfg), { recursive: true });
  const fp = pairingPath(cfg);
  await fs.writeFile(fp, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    await fs.chmod(fp, 0o600);
  } catch {
    /* */
  }
}

function genCode() {
  // Readable short code: XCLAW-XXXX
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  const bytes = crypto.randomBytes(4);
  for (let i = 0; i < 4; i++) s += alphabet[bytes[i] % alphabet.length];
  return `XCLAW-${s}`;
}

/**
 * Create a one-time pairing code for the caller's identity.
 * @param {object} cfg
 * @param {{ channel: string, userId: string, ttlMs?: number }} opts
 */
export async function createPairingCode(cfg, opts = {}) {
  const identity = normalizeChannelUserId({
    channel: opts.channel,
    userId: opts.userId,
  });
  if (identity === "default") {
    return { ok: false, error: "cannot create pairing code without user identity" };
  }

  // Rate limit: max 5 active codes per identity
  const data = await loadPairing(cfg);
  const now = Date.now();
  // prune expired
  for (const [code, rec] of Object.entries(data.codes || {})) {
    if (rec.expiresAt <= now) delete data.codes[code];
  }
  const activeForUser = Object.values(data.codes).filter((r) => r.identity === identity);
  if (activeForUser.length >= 5) {
    return { ok: false, error: "too many active pairing codes — wait for expiry or use an existing code" };
  }

  const requested = opts.ttlMs != null ? Number(opts.ttlMs) : 5 * 60_000;
  const ttlMs = Math.min(
    30 * 60_000,
    requested > 0 && requested < 60_000 ? Math.max(50, requested) : Math.max(60_000, requested || 5 * 60_000)
  );
  let code = genCode();
  let guard = 0;
  while (data.codes[code] && guard++ < 10) code = genCode();

  // Prefer existing account for this identity
  const accountId = (await resolveAccountId(cfg, identity)) || null;
  const codeKey = code.toUpperCase();
  data.codes[codeKey] = {
    identity,
    accountId,
    createdAt: now,
    expiresAt: now + ttlMs,
  };
  await savePairing(cfg, data);
  pairingMem.set(codeKey, data.codes[codeKey]);

  return {
    ok: true,
    code: codeKey,
    identity,
    accountId,
    expiresAt: new Date(now + ttlMs).toISOString(),
    expiresInSec: Math.round(ttlMs / 1000),
  };
}

/**
 * Consume a pairing code from another identity — links both to one account.
 */
export async function consumePairingCode(cfg, codeRaw, opts = {}) {
  let code = String(codeRaw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!code) return { ok: false, error: "missing code" };
  if (!code.startsWith("XCLAW-") && /^[A-Z0-9]{4,8}$/.test(code)) {
    code = `XCLAW-${code}`;
  }

  const toIdentity = normalizeChannelUserId({
    channel: opts.channel,
    userId: opts.userId,
  });
  if (toIdentity === "default") {
    return { ok: false, error: "cannot pair without user identity" };
  }

  const data = await loadPairing(cfg);
  const now = Date.now();
  const rec = data.codes[code] || pairingMem.get(code);
  if (!rec) {
    return { ok: false, error: "invalid or already used code", code: "invalid_code" };
  }
  if (rec.expiresAt <= now) {
    delete data.codes[code];
    await savePairing(cfg, data);
    pairingMem.delete(code);
    return { ok: false, error: "code expired — request a new /link code", code: "expired" };
  }

  const fromIdentity = rec.identity;
  if (fromIdentity === toIdentity) {
    return { ok: false, error: "cannot link the same identity to itself" };
  }

  // Single-use: remove before link (prevent double consume)
  delete data.codes[code];
  await savePairing(cfg, data);
  pairingMem.delete(code);

  const linked = await linkIdentities(cfg, fromIdentity, toIdentity);
  if (!linked.ok) return linked;

  return {
    ok: true,
    accountId: linked.accountId,
    identities: linked.identities,
    fromIdentity,
    toIdentity,
    account: linked.account,
  };
}

export async function pairingStatus(cfg, opts = {}) {
  const identity = normalizeChannelUserId({
    channel: opts.channel,
    userId: opts.userId,
  });
  const accountId = identity !== "default" ? await resolveAccountId(cfg, identity) : null;
  const store = await loadAccountStore(cfg);
  const account = accountId ? store.accounts[accountId] : null;
  return {
    identity,
    accountId,
    identities: account?.identities || (identity !== "default" ? [identity] : []),
    linked: Boolean(accountId),
  };
}


/**
 * Explicit L3 migrate: merge identity vault folders into account.
 */
export async function migrateAccountVault(cfg, accountId) {
  const store = await loadAccountStore(cfg);
  const acc = store.accounts[accountId];
  if (!acc) return { ok: false, error: `unknown account ${accountId}` };
  const { vaultMergeIntoAccount } = await import("./vault.mjs");
  return vaultMergeIntoAccount(cfg, accountId, acc.identities || []);
}
