/**
 * Cookie / web-session rotation strategies.
 *
 * Goals:
 *  - Limit lifetime of stolen session material
 *  - Force re-auth before expiry wall
 *  - Support multiple slots (primary + standby)
 *  - Detect reuse / anomaly triggers
 *  - Never log secret values
 *
 * `rotationPaths()` honours `cfg.auth?.web?.rotationStatePath` /
 * `previousSessionPath` then `paths.configDir` then `XCLAW_CONFIG_DIR`
 * then null. No home fallback. Do not honour `XCLAW_STATE_DIR`. A cfg
 * without configDir is never a real caller (`loadConfig()` stamps it
 * unconditionally). `writeState` still no-ops without persisting (do
 * not `mkdir(null)`). `readState` returns the empty default. Keep
 * `XCLAW_COOKIE_ROTATION` as the strategy env (not a path).
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  loadWebSession,
  importWebSession,
  clearWebSession,
  redactSecret,
} from "./web-login.mjs";

export const ROTATION_STRATEGIES = {
  /** Single session; rotate by max age only */
  ttl: {
    id: "ttl",
    description: "Expire and require re-import after maxAge",
  },
  /** Soft rotate: warn before expiry; hard fail after */
  sliding: {
    id: "sliding",
    description: "Extend TTL on successful use; cap at absolute max",
  },
  /** Dual-slot: keep previous cookie until new one verified */
  dual_slot: {
    id: "dual_slot",
    description: "Primary + previous; roll forward on successful refresh",
  },
  /** Time-boxed + use-count limit */
  budget: {
    id: "budget",
    description: "Max age AND max successful uses before forced rotation",
  },
};

function rotationPaths(cfg = {}) {
  const explicitState = cfg.auth?.web?.rotationStatePath;
  const explicitPrev = cfg.auth?.web?.previousSessionPath;
  const configDir = cfg.paths?.configDir || process.env.XCLAW_CONFIG_DIR || null;
  return {
    configDir,
    statePath:
      explicitState ||
      (configDir ? path.join(configDir, "cookie-rotation.json") : null),
    previousPath:
      explicitPrev ||
      (configDir ? path.join(configDir, "web-session.prev.json") : null),
  };
}

function rotationCfg(cfg = {}) {
  const w = cfg.auth?.web || {};
  return {
    strategy: w.rotationStrategy || process.env.XCLAW_COOKIE_ROTATION || "budget",
    maxAgeMs: Number(w.maxAgeMs) > 0 ? Number(w.maxAgeMs) : 30 * 24 * 3600 * 1000,
    /** sliding: max total lifetime from first import */
    absoluteMaxAgeMs:
      Number(w.absoluteMaxAgeMs) > 0
        ? Number(w.absoluteMaxAgeMs)
        : 90 * 24 * 3600 * 1000,
    /** soft warning window before expiry */
    softTtlMs: Number(w.softTtlMs) > 0 ? Number(w.softTtlMs) : 2 * 24 * 3600 * 1000,
    /** budget: max uses */
    maxUses: Number(w.maxUses) > 0 ? Number(w.maxUses) : 500,
    /** dual_slot: keep previous for this long after rotate */
    previousRetainMs:
      Number(w.previousRetainMs) > 0 ? Number(w.previousRetainMs) : 24 * 3600 * 1000,
  };
}

function emptyState() {
  return {
    strategy: null,
    useCount: 0,
    lastUsedAt: null,
    lastRotatedAt: null,
    firstImportedAt: null,
    generation: 0,
    fingerprint: null,
  };
}

async function readState(cfg) {
  const p = rotationPaths(cfg).statePath;
  if (!p) return emptyState();
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return emptyState();
  }
}

async function writeState(cfg, state) {
  const p = rotationPaths(cfg).statePath;
  if (!p) return;
  await fs.mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
  const tmp = `${p}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  await fs.rename(tmp, p);
}

/** Non-reversible fingerprint of cookie material for reuse detection */
export function cookieFingerprint(session) {
  const material = [
    session?.cookie || "",
    session?.authorization || "",
    (session?.cookies || []).map((c) => `${c.name}=${c.value}`).join("&"),
  ].join("|");
  if (!material.replace(/\|/g, "")) return null;
  return crypto.createHash("sha256").update(material).digest("hex").slice(0, 32);
}

/**
 * Evaluate whether session needs rotation / is still usable.
 */
export async function evaluateRotation(cfg = {}) {
  const rc = rotationCfg(cfg);
  const session = await loadWebSession(cfg);
  const state = await readState(cfg);
  const now = Date.now();

  if (!session) {
    return {
      ok: false,
      action: "reauth",
      reason: "no_session",
      strategy: rc.strategy,
    };
  }

  const fp = cookieFingerprint(session);
  const importedAt = session.imported_at || state.firstImportedAt || now;
  const expiresAt = session.expires_at || importedAt + rc.maxAgeMs;
  const age = now - importedAt;
  const useCount = state.useCount || 0;

  // Reuse detection: same fingerprint after forced rotate generation bump mismatch handled elsewhere
  const base = {
    strategy: rc.strategy,
    fingerprint: fp ? `${fp.slice(0, 6)}…` : null,
    useCount,
    ageMs: age,
    expires_at: expiresAt,
    generation: state.generation || 0,
  };

  if (now > expiresAt) {
    return { ...base, ok: false, action: "reauth", reason: "ttl_expired" };
  }

  if (rc.strategy === "ttl") {
    const soft = expiresAt - rc.softTtlMs;
    if (now >= soft) {
      return { ...base, ok: true, action: "warn", reason: "approaching_ttl" };
    }
    return { ...base, ok: true, action: "none", reason: "ok" };
  }

  if (rc.strategy === "sliding") {
    if (age > rc.absoluteMaxAgeMs) {
      return { ...base, ok: false, action: "reauth", reason: "absolute_max_age" };
    }
    const soft = expiresAt - rc.softTtlMs;
    if (now >= soft) {
      return { ...base, ok: true, action: "refresh_ttl", reason: "sliding_window" };
    }
    return { ...base, ok: true, action: "none", reason: "ok" };
  }

  if (rc.strategy === "budget") {
    if (useCount >= rc.maxUses) {
      return { ...base, ok: false, action: "reauth", reason: "max_uses" };
    }
    if (now > expiresAt) {
      return { ...base, ok: false, action: "reauth", reason: "ttl_expired" };
    }
    const usesLeft = rc.maxUses - useCount;
    if (usesLeft <= Math.max(10, Math.floor(rc.maxUses * 0.05))) {
      return { ...base, ok: true, action: "warn", reason: "uses_low", usesLeft };
    }
    return { ...base, ok: true, action: "none", reason: "ok", usesLeft };
  }

  if (rc.strategy === "dual_slot") {
    if (now > expiresAt) {
      return {
        ...base,
        ok: false,
        action: "promote_or_reauth",
        reason: "primary_expired",
      };
    }
    return { ...base, ok: true, action: "none", reason: "ok" };
  }

  return { ...base, ok: true, action: "none", reason: "ok" };
}

/**
 * Record a successful authenticated use (for budget / sliding).
 */
export async function recordSessionUse(cfg = {}, opts = {}) {
  const session = await loadWebSession(cfg);
  if (!session) return { ok: false, reason: "no_session" };

  const rc = rotationCfg(cfg);
  const state = await readState(cfg);
  const fp = cookieFingerprint(session);
  const now = Date.now();

  // Anomaly: fingerprint changed without going through rotate()
  if (state.fingerprint && fp && state.fingerprint !== fp && !opts.afterRotate) {
    return {
      ok: false,
      reason: "fingerprint_mismatch",
      action: "reauth",
      hint: "Session material changed unexpectedly — re-import web login",
    };
  }

  state.useCount = (state.useCount || 0) + 1;
  state.lastUsedAt = now;
  state.fingerprint = fp || state.fingerprint;
  state.strategy = rc.strategy;
  if (!state.firstImportedAt) state.firstImportedAt = session.imported_at || now;

  // Sliding: extend expires on soft use by rewriting max age metadata via re-import envelope is heavy;
  // track extended deadline in rotation state instead.
  if (rc.strategy === "sliding" && opts.extend) {
    state.slidingExpiresAt = now + rc.maxAgeMs;
    if (state.firstImportedAt + rc.absoluteMaxAgeMs < state.slidingExpiresAt) {
      state.slidingExpiresAt = state.firstImportedAt + rc.absoluteMaxAgeMs;
    }
  }

  await writeState(cfg, state);
  const evaluation = await evaluateRotation(cfg);
  return { ok: true, useCount: state.useCount, evaluation };
}

/**
 * Rotate: archive current → previous (dual_slot), clear primary, bump generation.
 * Caller must import a new session after.
 */
export async function rotateWebSession(cfg = {}, opts = {}) {
  const p = rotationPaths(cfg);
  const rc = rotationCfg(cfg);
  const session = await loadWebSession(cfg);
  const state = await readState(cfg);
  const now = Date.now();

  if (session && (rc.strategy === "dual_slot" || opts.keepPrevious) && p.previousPath) {
    try {
      // Store redacted meta + encrypted path copy is complex; store fingerprint only + timestamp
      const prevMeta = {
        archived_at: now,
        fingerprint: cookieFingerprint(session),
        retain_until: now + rc.previousRetainMs,
        generation: state.generation || 0,
      };
      await fs.mkdir(path.dirname(p.previousPath), { recursive: true, mode: 0o700 });
      // Move current file to previous if exists
      const main =
        cfg.auth?.web?.sessionPath ||
        (p.configDir ? path.join(p.configDir, "web-session.json") : null);
      try {
        if (main) await fs.rename(main, p.previousPath);
        else throw new Error("no session path");
      } catch {
        await fs.writeFile(
          p.previousPath + ".meta.json",
          JSON.stringify(prevMeta, null, 2),
          { mode: 0o600 }
        );
      }
    } catch {
      /* */
    }
  } else {
    await clearWebSession(cfg);
  }

  state.generation = (state.generation || 0) + 1;
  state.lastRotatedAt = now;
  state.useCount = 0;
  state.fingerprint = null;
  state.strategy = rc.strategy;
  await writeState(cfg, state);

  return {
    ok: true,
    action: "rotated",
    generation: state.generation,
    next: "xclaw auth web-import --cookie ...",
    strategy: rc.strategy,
  };
}

/**
 * After successful web-import of a *new* cookie, call this to bind fingerprint.
 */
export async function bindAfterImport(cfg = {}) {
  const session = await loadWebSession(cfg);
  if (!session) return { ok: false };
  const state = await readState(cfg);
  state.fingerprint = cookieFingerprint(session);
  state.firstImportedAt = session.imported_at || Date.now();
  state.useCount = 0;
  state.lastUsedAt = null;
  state.strategy = rotationCfg(cfg).strategy;
  await writeState(cfg, state);
  return {
    ok: true,
    generation: state.generation || 0,
    fingerprint: state.fingerprint
      ? redactSecret(state.fingerprint, 4)
      : null,
  };
}

/**
 * High-level gate before using web auth for a model call.
 */
export async function gateWebSession(cfg = {}) {
  const ev = await evaluateRotation(cfg);
  if (!ev.ok && (ev.action === "reauth" || ev.action === "promote_or_reauth")) {
    return {
      allowed: false,
      ...ev,
      message: `Web session requires rotation (${ev.reason}). Run: xclaw auth login --method web`,
    };
  }
  if (ev.ok) {
    await recordSessionUse(cfg, {
      extend: ev.action === "refresh_ttl",
    });
  }
  return { allowed: ev.ok || ev.action === "warn", ...ev };
}

export function listRotationStrategies() {
  return Object.values(ROTATION_STRATEGIES);
}
