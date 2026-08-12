/**
 * Fingerprint rotation — rotate the identity binding of web sessions
 * independent of (or together with) cookie material rotation.
 *
 * Cookie fingerprint  = hash(session secrets)
 * Binding fingerprint = hash(cookieFingerprint || generation || salt)
 *
 * Rotating the binding salt invalidates old bindings without necessarily
 * deleting the cookie file — used after suspected leak of rotation state.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  cookieFingerprint,
  evaluateRotation,
  bindAfterImport,
} from "./cookie-rotation.mjs";
import { loadWebSession, redactSecret } from "./web-login.mjs";

function fpPaths(cfg = {}) {
  const configDir =
    cfg.paths?.configDir ||
    process.env.XCLAW_CONFIG_DIR ||
    path.join(os.homedir(), ".xclaw");
  return {
    configDir,
    fpStatePath:
      cfg.auth?.web?.fingerprintStatePath ||
      path.join(configDir, "fingerprint-rotation.json"),
  };
}

async function readFpState(cfg) {
  try {
    return JSON.parse(
      await fs.readFile(fpPaths(cfg).fpStatePath, "utf8")
    );
  } catch {
    return {
      version: 1,
      salt: null,
      previousSalt: null,
      generation: 0,
      binding: null,
      previousBinding: null,
      rotatedAt: null,
      history: [],
    };
  }
}

async function writeFpState(cfg, state) {
  const p = fpPaths(cfg).fpStatePath;
  await fs.mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
  const tmp = `${p}.${process.pid}.tmp`;
  const body = JSON.stringify(state, null, 2) + "\n";
  await fs.writeFile(tmp, body, { mode: 0o600 });
  await fs.rename(tmp, p);
  try {
    await fs.chmod(p, 0o600);
  } catch {
    /* */
  }
}

export function newSalt(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

/**
 * Cookie material fingerprint (from cookie-rotation) or compute now.
 */
export function materialFingerprint(session) {
  return cookieFingerprint(session);
}

/**
 * Binding fingerprint: ties material + generation + salt.
 * Rotating salt → new binding even if cookie unchanged.
 */
export function bindingFingerprint(materialFp, generation, salt) {
  if (!materialFp || !salt) return null;
  return crypto
    .createHash("sha256")
    .update(`xclaw-fp-v1|${materialFp}|${generation}|${salt}`)
    .digest("hex");
}

/**
 * Short display id (safe to log).
 */
export function shortFp(fp) {
  if (!fp) return null;
  return redactSecret(fp, 4);
}

/**
 * Ensure salt exists; bind current session material.
 */
export async function ensureFingerprintBinding(cfg = {}) {
  const session = await loadWebSession(cfg);
  if (!session) {
    return { ok: false, reason: "no_session" };
  }
  const material = materialFingerprint(session);
  if (!material) {
    return { ok: false, reason: "no_material" };
  }

  const state = await readFpState(cfg);
  if (!state.salt) {
    state.salt = newSalt();
    state.generation = state.generation || 0;
  }
  const binding = bindingFingerprint(
    material,
    state.generation,
    state.salt
  );
  state.binding = binding;
  state.material = material;
  state.boundAt = Date.now();
  await writeFpState(cfg, state);

  return {
    ok: true,
    generation: state.generation,
    binding: shortFp(binding),
    material: shortFp(material),
  };
}

/**
 * Rotate fingerprint salt (and optionally bump generation).
 * Previous binding kept briefly for dual-verify window.
 *
 * @param {'salt'|'generation'|'both'} mode
 */
/**
 * Dual-window snapshot of the binding that is about to be retired.
 * Stored explicitly so verify does not guess generation from history.
 */
function snapshotPreviousBinding(state, now, retainMs) {
  return {
    previousSalt: state.salt,
    previousBinding: state.binding,
    previousMaterial: state.material,
    previousGeneration: state.generation || 0,
    previousRotatedAt: state.rotatedAt,
    previousValidUntil: now + retainMs,
  };
}

export function dualWindowOpen(state, now = Date.now()) {
  return Boolean(
    state?.previousSalt &&
      state?.previousBinding &&
      state?.previousValidUntil &&
      now <= state.previousValidUntil
  );
}

export function dualWindowRemainingMs(state, now = Date.now()) {
  if (!dualWindowOpen(state, now)) return 0;
  return Math.max(0, state.previousValidUntil - now);
}

export async function rotateFingerprint(cfg = {}, opts = {}) {
  const mode = opts.mode || "both";
  const state = await readFpState(cfg);
  const session = await loadWebSession(cfg);
  const material = session ? materialFingerprint(session) : state.material;
  const now = Date.now();

  const retainMs =
    Number(cfg.auth?.web?.fingerprintPreviousRetainMs) > 0
      ? Number(cfg.auth.web.fingerprintPreviousRetainMs)
      : Number(opts.retainMs) > 0
        ? Number(opts.retainMs)
        : 60 * 60 * 1000; // 1h default dual window

  // --- dual window: freeze old binding before mutation ---
  const prev = snapshotPreviousBinding(state, now, retainMs);
  Object.assign(state, prev);

  if (mode === "salt" || mode === "both") {
    state.salt = newSalt();
  }
  if (mode === "generation" || mode === "both") {
    state.generation = (state.generation || 0) + 1;
  }

  const binding = material
    ? bindingFingerprint(material, state.generation, state.salt)
    : null;

  state.binding = binding;
  state.material = material || state.material;
  state.rotatedAt = now;
  state.history = [
    {
      at: now,
      mode,
      generation: state.generation,
      previousGeneration: prev.previousGeneration,
      dualWindowMs: retainMs,
      binding: binding ? binding.slice(0, 8) : null,
    },
    ...(state.history || []),
  ].slice(0, 20);

  await writeFpState(cfg, state);

  if (mode === "generation" || mode === "both") {
    try {
      await bindAfterImport(cfg);
    } catch {
      /* */
    }
  }

  return {
    ok: true,
    mode,
    generation: state.generation,
    previousGeneration: prev.previousGeneration,
    binding: shortFp(binding),
    previousBinding: shortFp(prev.previousBinding),
    previousValidUntil: state.previousValidUntil,
    dualWindowMs: retainMs,
    dualWindowOpen: true,
  };
}

/**
 * Verify session material matches current (or previous-in-window) binding.
 */
export async function verifyFingerprint(cfg = {}) {
  const session = await loadWebSession(cfg);
  if (!session) {
    return { ok: false, reason: "no_session" };
  }
  const material = materialFingerprint(session);
  const state = await readFpState(cfg);
  if (!state.salt) {
    // First time — bind
    return ensureFingerprintBinding(cfg);
  }

  const current = bindingFingerprint(
    material,
    state.generation,
    state.salt
  );
  if (current && current === state.binding) {
    return {
      ok: true,
      match: "current",
      generation: state.generation,
      binding: shortFp(current),
    };
  }

  // Dual window: accept previous salt + previousGeneration binding
  const now = Date.now();
  if (dualWindowOpen(state, now)) {
    const prevGen =
      state.previousGeneration != null
        ? state.previousGeneration
        : Math.max(0, (state.generation || 1) - 1);
    const prev = bindingFingerprint(
      material,
      prevGen,
      state.previousSalt
    );
    if (prev && prev === state.previousBinding) {
      return {
        ok: true,
        match: "previous",
        generation: prevGen,
        binding: shortFp(prev),
        previousValidUntil: state.previousValidUntil,
        dualWindowRemainingMs: dualWindowRemainingMs(state, now),
      };
    }
  }

  // Material changed under same salt → theft or re-import without bind
  if (state.material && material && state.material !== material) {
    return {
      ok: false,
      reason: "material_changed",
      action: "reauth_or_bind",
      hint: "Cookie changed — run web-import + fingerprint bind, or auth rotate",
    };
  }

  return {
    ok: false,
    reason: "binding_mismatch",
    action: "rotate_or_reauth",
    generation: state.generation,
  };
}

/**
 * Full gate: cookie rotation policy + fingerprint verify.
 */
export async function gateWithFingerprint(cfg = {}) {
  const fp = await verifyFingerprint(cfg);
  if (!fp.ok) {
    return {
      allowed: false,
      layer: "fingerprint",
      ...fp,
    };
  }
  const rot = await evaluateRotation(cfg);
  if (!rot.ok && rot.action === "reauth") {
    return {
      allowed: false,
      layer: "cookie_rotation",
      ...rot,
    };
  }
  return {
    allowed: true,
    layer: "ok",
    fingerprint: fp,
    rotation: rot,
  };
}

/**
 * Status for CLI (redacted).
 */
export async function fingerprintStatus(cfg = {}) {
  const state = await readFpState(cfg);
  const now = Date.now();
  return {
    generation: state.generation || 0,
    hasSalt: Boolean(state.salt),
    binding: shortFp(state.binding),
    material: shortFp(state.material),
    rotatedAt: state.rotatedAt,
    dualWindow: {
      open: dualWindowOpen(state, now),
      remainingMs: dualWindowRemainingMs(state, now),
      previousValidUntil: state.previousValidUntil || null,
      previousGeneration:
        state.previousGeneration != null ? state.previousGeneration : null,
      previousBinding: shortFp(state.previousBinding),
    },
    history: (state.history || []).slice(0, 5),
  };
}

/**
 * Explicitly close dual window (e.g. after confirmed cutover).
 */
export async function closeDualWindow(cfg = {}) {
  const state = await readFpState(cfg);
  state.previousSalt = null;
  state.previousBinding = null;
  state.previousMaterial = null;
  state.previousGeneration = null;
  state.previousValidUntil = null;
  await writeFpState(cfg, state);
  return { ok: true, dualWindowOpen: false };
}
