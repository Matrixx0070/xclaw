/**
 * Automated key rotation strategies for XClaw signing / verification keys.
 *
 * Strategies:
 *   ttl          — rotate when maxAge exceeded
 *   budget       — rotate after maxUses successful ops
 *   scheduled    — rotate at intervalMs wall clock
 *   dual_slot    — always keep previous generation verifiable during window
 *   hybrid       — ttl OR budget OR scheduled (first trigger wins)
 *
 * Dual window: after rotate, both current and previous public keys
 * verify signatures until previousValidUntil (default 1h).
 *
 * Keys are P-256 (ES256-compatible). Private keys stored encrypted-at-rest
 * when XCLAW_KEY_SECRET / auth.keys.secret is set.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  durableAtomicWriteJson,
  durableWritesEnabled,
} from "../utils/durable-write.mjs";

export const KEY_ROTATION_STRATEGIES = {
  ttl: {
    id: "ttl",
    description: "Rotate when key age exceeds maxAgeMs",
  },
  budget: {
    id: "budget",
    description: "Rotate after maxUses sign/verify operations",
  },
  scheduled: {
    id: "scheduled",
    description: "Rotate every intervalMs",
  },
  dual_slot: {
    id: "dual_slot",
    description: "Rotate on demand; keep previous key for dual window",
  },
  hybrid: {
    id: "hybrid",
    description: "Rotate on ttl OR budget OR scheduled — whichever fires first",
  },
};

export class KeyRotationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "KeyRotationError";
    this.code = code;
    this.details = details;
  }
}

function paths(cfg = {}) {
  const configDir =
    cfg.paths?.configDir ||
    process.env.XCLAW_CONFIG_DIR ||
    path.join(os.homedir(), ".xclaw");
  return {
    configDir,
    storePath:
      cfg.auth?.keys?.storePath || path.join(configDir, "key-rotation.json"),
  };
}

function policy(cfg = {}) {
  const k = cfg.auth?.keys || {};
  return {
    strategy:
      k.rotationStrategy ||
      process.env.XCLAW_KEY_ROTATION ||
      "hybrid",
    maxAgeMs: Number(k.maxAgeMs) > 0 ? Number(k.maxAgeMs) : 30 * 24 * 3600 * 1000,
    maxUses: Number(k.maxUses) > 0 ? Number(k.maxUses) : 10_000,
    intervalMs:
      Number(k.intervalMs) > 0 ? Number(k.intervalMs) : 7 * 24 * 3600 * 1000,
    dualWindowMs:
      Number(k.dualWindowMs) > 0 ? Number(k.dualWindowMs) : 60 * 60 * 1000,
    secret:
      k.secret ||
      process.env.XCLAW_KEY_SECRET ||
      process.env.XCLAW_SESSION_SECRET ||
      null,
    autoRotate: k.autoRotate !== false,
  };
}

function now() {
  return Date.now();
}

function newKid(generation) {
  return `xclaw-es256-g${generation}-${crypto.randomBytes(4).toString("hex")}`;
}

function generateP256Pair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  return {
    publicJwk: publicKey.export({ format: "jwk" }),
    privateJwk: privateKey.export({ format: "jwk" }),
  };
}

function deriveKey(secret) {
  return crypto.createHash("sha256").update(String(secret)).digest();
}

function encryptJwk(jwk, secret) {
  if (!secret) {
    return { enc: false, jwk };
  }
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const pt = Buffer.from(JSON.stringify(jwk), "utf8");
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    enc: true,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: ct.toString("base64"),
  };
}

function decryptJwk(blob, secret) {
  if (!blob) return null;
  if (!blob.enc) return blob.jwk || null;
  if (!secret) {
    throw new KeyRotationError(
      "DECRYPT_FAILED",
      "encrypted private key present but no XCLAW_KEY_SECRET"
    );
  }
  const key = deriveKey(secret);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(blob.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(blob.data, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(pt.toString("utf8"));
}

async function readStore(cfg) {
  try {
    return JSON.parse(await fs.readFile(paths(cfg).storePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeStore(cfg, store) {
  const p = paths(cfg).storePath;
  await durableAtomicWriteJson(p, store, {
    durable: durableWritesEnabled(cfg),
    mode: 0o600,
    dirMode: 0o700,
  });
}

function emptyStore(pol) {
  const generation = 1;
  const pair = generateP256Pair();
  const t = now();
  return {
    version: 1,
    strategy: pol.strategy,
    generation,
    kid: newKid(generation),
    createdAt: t,
    rotatedAt: t,
    useCount: 0,
    publicJwk: pair.publicJwk,
    privateBlob: encryptJwk(pair.privateJwk, pol.secret),
    previous: null,
    history: [],
  };
}

/**
 * Ensure a key store exists (create generation 1 if missing).
 */
export async function ensureKeyStore(cfg = {}) {
  const pol = policy(cfg);
  let store = await readStore(cfg);
  if (!store) {
    store = emptyStore(pol);
    await writeStore(cfg, store);
  }
  return statusFrom(store, pol);
}

/**
 * Dual-window overlap state.
 *
 * During overlap:
 *   - current key is used for all new signatures
 *   - previous public key still verifies (in-flight / lagging verifiers)
 * After validUntil (or closeDualWindow): previous is purged.
 */
export function getDualWindowState(store, t = now()) {
  if (!store?.previous?.validUntil || !store.previous.publicJwk) {
    return {
      open: false,
      remainingMs: 0,
      totalMs: 0,
      elapsedMs: 0,
      overlapRatio: 0,
      previousKid: null,
      previousGeneration: null,
      previousValidUntil: null,
      openedAt: null,
    };
  }
  const openedAt =
    store.previous.openedAt ||
    store.rotatedAt ||
    store.previous.rotatedAt ||
    t;
  const validUntil = store.previous.validUntil;
  const totalMs = Math.max(0, validUntil - openedAt);
  const remainingMs = Math.max(0, validUntil - t);
  const open = t <= validUntil && remainingMs > 0;
  const elapsedMs = Math.max(0, t - openedAt);
  return {
    open,
    remainingMs: open ? remainingMs : 0,
    totalMs,
    elapsedMs: open ? elapsedMs : totalMs,
    overlapRatio: totalMs > 0 ? Math.min(1, remainingMs / totalMs) : 0,
    previousKid: store.previous.kid || null,
    previousGeneration: store.previous.generation ?? null,
    previousValidUntil: validUntil,
    openedAt,
  };
}

/** Purge previous slot if dual window expired. Returns true if purged. */
export function purgeExpiredPrevious(store, t = now()) {
  if (!store?.previous) return false;
  if (store.previous.validUntil && t > store.previous.validUntil) {
    store.previous = null;
    return true;
  }
  return false;
}

function statusFrom(store, pol, t = now()) {
  purgeExpiredPrevious(store, t);
  const dual = getDualWindowState(store, t);
  return {
    strategy: store.strategy || pol.strategy,
    generation: store.generation,
    kid: store.kid,
    createdAt: store.createdAt,
    rotatedAt: store.rotatedAt,
    useCount: store.useCount || 0,
    ageMs: t - (store.rotatedAt || store.createdAt || t),
    publicJwk: store.publicJwk,
    dualWindow: dual,
    policy: {
      maxAgeMs: pol.maxAgeMs,
      maxUses: pol.maxUses,
      intervalMs: pol.intervalMs,
      dualWindowMs: pol.dualWindowMs,
      autoRotate: pol.autoRotate,
    },
  };
}

/**
 * Evaluate whether rotation is due (does not rotate).
 */
export async function evaluateKeyRotation(cfg = {}) {
  const pol = policy(cfg);
  let store = await readStore(cfg);
  if (!store) {
    return { ok: false, action: "init", reason: "no_store" };
  }
  const t = now();
  const age = t - (store.rotatedAt || store.createdAt || t);
  const uses = store.useCount || 0;
  const strategy = store.strategy || pol.strategy;

  const triggers = [];
  if (strategy === "ttl" || strategy === "hybrid") {
    if (age >= pol.maxAgeMs) triggers.push("ttl_expired");
  }
  if (strategy === "budget" || strategy === "hybrid") {
    if (uses >= pol.maxUses) triggers.push("max_uses");
  }
  if (strategy === "scheduled" || strategy === "hybrid") {
    if (age >= pol.intervalMs) triggers.push("schedule");
  }

  if (triggers.length) {
    return {
      ok: true,
      action: "rotate",
      reason: triggers[0],
      triggers,
      generation: store.generation,
      strategy,
    };
  }

  // Soft warnings
  const soft = [];
  if (age >= pol.maxAgeMs * 0.9) soft.push("age_high");
  if (uses >= pol.maxUses * 0.9) soft.push("uses_high");

  return {
    ok: true,
    action: soft.length ? "warn" : "none",
    reason: soft[0] || "ok",
    soft,
    generation: store.generation,
    strategy,
  };
}

/**
 * Rotate keys: new P-256 pair, archive previous into dual window.
 */
export async function rotateKeys(cfg = {}, opts = {}) {
  const pol = policy(cfg);
  let store = await readStore(cfg);
  if (!store) store = emptyStore(pol);

  const t = now();
  const pair = generateP256Pair();
  const nextGen = (store.generation || 0) + 1;

  const dualMs = opts.dualWindowMs ?? pol.dualWindowMs;
  // Overlap: previous remains verifiable; private of previous kept only if
  // opts.retainPreviousPrivate (default false for safety — verify needs public only)
  const previous = {
    generation: store.generation,
    kid: store.kid,
    publicJwk: store.publicJwk,
    privateBlob: opts.retainPreviousPrivate ? store.privateBlob : null,
    rotatedAt: store.rotatedAt,
    openedAt: t,
    validUntil: t + dualMs,
    dualWindowMs: dualMs,
  };

  store.history = [
    {
      at: t,
      from: store.generation,
      to: nextGen,
      reason: opts.reason || "manual",
      previousKid: store.kid,
    },
    ...(store.history || []),
  ].slice(0, 30);

  store.previous = previous;
  store.generation = nextGen;
  store.kid = newKid(nextGen);
  store.publicJwk = pair.publicJwk;
  store.privateBlob = encryptJwk(pair.privateJwk, pol.secret);
  store.rotatedAt = t;
  store.useCount = 0;
  store.strategy = pol.strategy;

  await writeStore(cfg, store);
  // Distributed JWKS invalidation + local cache bust
  try {
    const { refreshJwksAfterRotation } = await import("./jwks.mjs");
    await refreshJwksAfterRotation(cfg, {
      reason: opts.reason || "rotate",
      generation: nextGen,
      kid: store.kid,
    });
  } catch {
    /* optional */
  }
  return {
    ok: true,
    action: "rotated",
    generation: nextGen,
    kid: store.kid,
    previousKid: previous.kid,
    dualWindowMs: previous.validUntil - t,
    previousValidUntil: previous.validUntil,
  };
}

/**
 * Auto-rotate if policy says so. Returns status after any rotation.
 * Force with opts.force even when autoRotate is false.
 */
export async function maybeAutoRotate(cfg = {}, opts = {}) {
  const pol = policy(cfg);
  await ensureKeyStore(cfg);
  if (!pol.autoRotate && !opts.force) {
    return { rotated: false, autoRotate: false, ...(await evaluateKeyRotation(cfg)) };
  }
  const ev = await evaluateKeyRotation(cfg);
  if (ev.action === "rotate" || opts.forceRotate) {
    const reason = opts.reason || ev.reason || "auto";
    const r = await rotateKeys(cfg, { reason: `auto:${reason}` });
    return { rotated: true, auto: true, ...r };
  }
  return { rotated: false, autoRotate: true, ...ev };
}

/**
 * Record a use (sign or successful verify with current key).
 * May trigger auto-rotate under budget/hybrid.
 */
export async function recordKeyUse(cfg = {}) {
  const pol = policy(cfg);
  let store = await readStore(cfg);
  if (!store) {
    await ensureKeyStore(cfg);
    store = await readStore(cfg);
  }
  store.useCount = (store.useCount || 0) + 1;
  await writeStore(cfg, store);

  if (pol.autoRotate) {
    const ev = await evaluateKeyRotation(cfg);
    if (ev.action === "rotate") {
      return rotateKeys(cfg, { reason: ev.reason });
    }
  }
  return { ok: true, useCount: store.useCount };
}

/**
 * Public keys eligible for verify: current first, then previous if overlap open.
 * Order matters: prefer current match for kid-less verify.
 */
export async function getVerificationKeys(cfg = {}) {
  const store = await readStore(cfg);
  if (!store) return [];
  const t = now();
  if (purgeExpiredPrevious(store, t)) {
    await writeStore(cfg, store);
  }
  const keys = [
    {
      generation: store.generation,
      kid: store.kid,
      publicJwk: store.publicJwk,
      current: true,
      slot: "current",
    },
  ];
  const dual = getDualWindowState(store, t);
  if (dual.open && store.previous?.publicJwk) {
    keys.push({
      generation: store.previous.generation,
      kid: store.previous.kid,
      publicJwk: store.previous.publicJwk,
      current: false,
      slot: "previous",
      dualWindowRemainingMs: dual.remainingMs,
    });
  }
  return keys;
}

/**
 * Close dual-window overlap immediately (e.g. after confirmed compromise
 * of the previous key). New signatures already use current only.
 */
export async function closeDualWindow(cfg = {}) {
  const store = await readStore(cfg);
  if (!store) {
    return { ok: false, error: "no_store" };
  }
  const had = Boolean(store.previous);
  store.previous = null;
  await writeStore(cfg, store);
  return { ok: true, closed: had, dualWindowOpen: false };
}

/**
 * Extend overlap deadline (ops: lagging consumers need more time).
 * Caps at maxExtraMs from now to avoid indefinite exposure.
 */
export async function extendDualWindow(cfg = {}, extraMs, opts = {}) {
  const pol = policy(cfg);
  const store = await readStore(cfg);
  if (!store?.previous) {
    return { ok: false, error: "no_active_dual_window" };
  }
  const t = now();
  const dual = getDualWindowState(store, t);
  if (!dual.open) {
    return { ok: false, error: "dual_window_already_closed" };
  }
  const add = Number(extraMs);
  if (!(add > 0)) {
    return { ok: false, error: "extraMs must be positive" };
  }
  const maxExtra =
    Number(opts.maxExtraMs) > 0
      ? Number(opts.maxExtraMs)
      : pol.dualWindowMs * 2;
  const capped = Math.min(add, maxExtra);
  store.previous.validUntil = t + dual.remainingMs + capped;
  store.previous.extendedAt = t;
  store.previous.extendedMs = (store.previous.extendedMs || 0) + capped;
  await writeStore(cfg, store);
  return {
    ok: true,
    previousValidUntil: store.previous.validUntil,
    remainingMs: store.previous.validUntil - t,
    extendedMs: capped,
  };
}

/**
 * Snapshot dual-window overlap for status/CLI.
 */
export async function dualWindowStatus(cfg = {}) {
  const store = await readStore(cfg);
  if (!store) return { initialized: false, open: false };
  const t = now();
  if (purgeExpiredPrevious(store, t)) {
    await writeStore(cfg, store);
  }
  return {
    initialized: true,
    generation: store.generation,
    kid: store.kid,
    ...getDualWindowState(store, t),
  };
}

/**
 * Current private key KeyObject for signing (decrypt if needed).
 */
export async function getSigningKey(cfg = {}) {
  const pol = policy(cfg);
  await maybeAutoRotate(cfg);
  const store = await readStore(cfg);
  if (!store) {
    throw new KeyRotationError("NO_STORE", "key store not initialized");
  }
  const jwk = decryptJwk(store.privateBlob, pol.secret);
  if (!jwk) {
    throw new KeyRotationError("NO_PRIVATE", "private key unavailable");
  }
  const keyObject = crypto.createPrivateKey({ key: jwk, format: "jwk" });
  return {
    keyObject,
    kid: store.kid,
    generation: store.generation,
    publicJwk: store.publicJwk,
  };
}

/**
 * Sign bytes with current key (ES256 / P1363). Records use + maybe rotate.
 */
export async function signWithCurrentKey(cfg, data) {
  const { keyObject, kid, generation } = await getSigningKey(cfg);
  const signature = crypto.sign("sha256", Buffer.from(data), {
    key: keyObject,
    dsaEncoding: "ieee-p1363",
  });
  await recordKeyUse(cfg);
  return {
    signature,
    kid,
    generation,
    alg: "ES256",
  };
}

/**
 * Verify with current or previous (dual window) public key.
 */
export async function verifyWithRotatedKeys(cfg, data, signature, opts = {}) {
  const keys = await getVerificationKeys(cfg);
  if (!keys.length) {
    return { ok: false, error: "no verification keys", code: "NO_KEYS" };
  }
  const dataBuf = Buffer.from(data);
  const sigBuf = Buffer.from(signature);

  for (const k of keys) {
    try {
      const pub = crypto.createPublicKey({ key: k.publicJwk, format: "jwk" });
      const ok = crypto.verify(
        "sha256",
        dataBuf,
        { key: pub, dsaEncoding: "ieee-p1363" },
        sigBuf
      );
      if (ok) {
        if (k.current && opts.recordUse) await recordKeyUse(cfg);
        return {
          ok: true,
          kid: k.kid,
          generation: k.generation,
          current: k.current,
        };
      }
    } catch {
      /* try next */
    }
  }
  return { ok: false, error: "signature invalid for all active keys" };
}

export async function keyRotationStatus(cfg = {}) {
  const pol = policy(cfg);
  const store = await readStore(cfg);
  if (!store) return { initialized: false };
  return { initialized: true, ...statusFrom(store, pol) };
}

export function listKeyRotationStrategies() {
  return Object.values(KEY_ROTATION_STRATEGIES);
}
