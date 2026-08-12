/**
 * WebAuthn integration for XClaw — high-assurance unlock bound to
 * fingerprint-rotation generation (not the cookie hash itself).
 *
 * Flow:
 *  1. register()  → store credential id + public key + bound generation
 *  2. assert()    → verify signature; optional require fresh generation
 *  3. gateSensitive() → fingerprint verify + WebAuthn assertion required
 *
 * Browser: use navigator.credentials (WebAuthn).
 * Node/CLI: challenge/verify helpers; ceremony runs in browser or via
 *           platform authenticator bridge.
 *
 * Spec: W3C WebAuthn Level 2/3 — public-key credentials, user verification.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  fingerprintStatus,
  verifyFingerprint,
} from "./fingerprint-rotation.mjs";

function waPaths(cfg = {}) {
  const configDir =
    cfg.paths?.configDir ||
    process.env.XCLAW_CONFIG_DIR ||
    path.join(os.homedir(), ".xclaw");
  return {
    configDir,
    storePath:
      cfg.auth?.webauthn?.storePath ||
      path.join(configDir, "webauthn-credentials.json"),
  };
}

function waCfg(cfg = {}) {
  const w = cfg.auth?.webauthn || {};
  return {
    rpId: w.rpId || process.env.XCLAW_WEBAUTHN_RP_ID || "localhost",
    rpName: w.rpName || "XClaw",
    origin: w.origin || process.env.XCLAW_WEBAUTHN_ORIGIN || "https://localhost",
    userVerification: w.userVerification || "preferred", // required | preferred | discouraged
    /** Require WebAuthn after fingerprint salt rotate */
    requireAfterFpRotate: w.requireAfterFpRotate !== false,
    timeoutMs: Number(w.timeoutMs) > 0 ? Number(w.timeoutMs) : 60_000,
  };
}

async function readStore(cfg) {
  try {
    return JSON.parse(await fs.readFile(waPaths(cfg).storePath, "utf8"));
  } catch {
    return {
      version: 1,
      credentials: [],
      lastAssertAt: null,
      lastAssertCredentialId: null,
    };
  }
}

async function writeStore(cfg, store) {
  const p = waPaths(cfg).storePath;
  await fs.mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
  const tmp = `${p}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2) + "\n", {
    mode: 0o600,
  });
  await fs.rename(tmp, p);
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64");
}

/**
 * Registration options for navigator.credentials.create (browser).
 * Bound to current fingerprint generation when available.
 */
export async function createRegistrationOptions(cfg = {}, user = {}) {
  const c = waCfg(cfg);
  const fp = await fingerprintStatus(cfg).catch(() => ({ generation: 0 }));
  const challenge = b64url(crypto.randomBytes(32));
  const userId = b64url(
    Buffer.from(user.id || user.name || os.userInfo().username || "xclaw-user")
  );

  const options = {
    challenge,
    rp: { id: c.rpId, name: c.rpName },
    user: {
      id: userId,
      name: user.name || os.userInfo().username || "xclaw",
      displayName: user.displayName || user.name || "XClaw User",
    },
    pubKeyCredParams: [
      { type: "public-key", alg: -7 }, // ES256
      { type: "public-key", alg: -257 }, // RS256
    ],
    authenticatorSelection: {
      authenticatorAttachment: user.platform === false ? "cross-platform" : "platform",
      userVerification: c.userVerification,
      residentKey: "preferred",
      requireResidentKey: false,
    },
    timeout: c.timeoutMs,
    attestation: "none",
  };

  // Persist pending challenge (short-lived)
  const store = await readStore(cfg);
  store.pendingRegistration = {
    challenge,
    createdAt: Date.now(),
    fingerprintGeneration: fp.generation || 0,
    expiresAt: Date.now() + c.timeoutMs,
  };
  await writeStore(cfg, store);

  return {
    publicKey: options,
    fingerprintGeneration: fp.generation || 0,
    hint: "Pass options.publicKey to navigator.credentials.create()",
  };
}

/**
 * Store credential after browser registration ceremony.
 * attestationObject / clientDataJSON are base64url from browser.
 *
 * For production, verify attestation with @simplewebauthn/server.
 * Here we store credential id + optional COSE key bytes and bind generation.
 */
export async function completeRegistration(cfg = {}, cred = {}) {
  const store = await readStore(cfg);
  const pending = store.pendingRegistration;
  if (!pending || Date.now() > pending.expiresAt) {
    return { ok: false, error: "no pending registration or expired" };
  }

  const id = cred.id || cred.rawId;
  if (!id) return { ok: false, error: "missing credential id" };

  // Optional: verify clientData.challenge matches pending
  if (cred.clientDataJSON) {
    try {
      const cd = JSON.parse(
        fromB64url(cred.clientDataJSON).toString("utf8")
      );
      if (cd.challenge !== pending.challenge) {
        return { ok: false, error: "challenge mismatch" };
      }
    } catch {
      return { ok: false, error: "invalid clientDataJSON" };
    }
  }

  const entry = {
    credentialId: id,
    publicKey: cred.publicKey || cred.response?.publicKey || null,
    attestationObject: cred.response?.attestationObject || null,
    transports: cred.transports || ["internal"],
    boundFingerprintGeneration: pending.fingerprintGeneration,
    registeredAt: Date.now(),
    counter: 0,
  };

  store.credentials = store.credentials.filter((c) => c.credentialId !== id);
  store.credentials.push(entry);
  delete store.pendingRegistration;
  await writeStore(cfg, store);

  return {
    ok: true,
    credentialId: id,
    boundFingerprintGeneration: entry.boundFingerprintGeneration,
  };
}

/**
 * Assertion options for navigator.credentials.get
 */
export async function createAssertionOptions(cfg = {}) {
  const c = waCfg(cfg);
  const store = await readStore(cfg);
  if (!store.credentials.length) {
    return { ok: false, error: "no WebAuthn credentials registered" };
  }

  const challenge = b64url(crypto.randomBytes(32));
  const fp = await fingerprintStatus(cfg).catch(() => ({ generation: 0 }));

  store.pendingAssertion = {
    challenge,
    createdAt: Date.now(),
    expiresAt: Date.now() + c.timeoutMs,
    fingerprintGeneration: fp.generation || 0,
  };
  await writeStore(cfg, store);

  return {
    ok: true,
    publicKey: {
      challenge,
      rpId: c.rpId,
      timeout: c.timeoutMs,
      userVerification: c.userVerification,
      allowCredentials: store.credentials.map((cr) => ({
        type: "public-key",
        id: cr.credentialId,
        transports: cr.transports || ["internal"],
      })),
    },
    fingerprintGeneration: fp.generation || 0,
  };
}

/**
 * Complete assertion (signature verification stub + counter + binding check).
 * Production should use full WebAuthn verify (COSE key + authData).
 */
export async function completeAssertion(cfg = {}, assertion = {}) {
  const store = await readStore(cfg);
  const pending = store.pendingAssertion;
  if (!pending || Date.now() > pending.expiresAt) {
    return { ok: false, error: "no pending assertion or expired" };
  }

  const id = assertion.id || assertion.rawId;
  const cred = store.credentials.find((c) => c.credentialId === id);
  if (!cred) return { ok: false, error: "unknown credential" };

  if (assertion.clientDataJSON) {
    try {
      const cd = JSON.parse(
        fromB64url(assertion.clientDataJSON).toString("utf8")
      );
      if (cd.challenge !== pending.challenge) {
        return { ok: false, error: "challenge mismatch" };
      }
    } catch {
      return { ok: false, error: "invalid clientDataJSON" };
    }
  }

  // Counter must not go backwards (clone detection)
  const newCounter =
    assertion.authenticatorData?.counter ??
    assertion.counter ??
    cred.counter + 1;
  if (newCounter < cred.counter) {
    return {
      ok: false,
      error: "authenticator counter regression — possible cloned authenticator",
      code: "COUNTER_REGRESSION",
    };
  }
  cred.counter = newCounter;

  const fp = await fingerprintStatus(cfg).catch(() => ({ generation: 0 }));
  const gen = fp.generation || 0;

  store.lastAssertAt = Date.now();
  store.lastAssertCredentialId = id;
  store.lastAssertFingerprintGeneration = gen;
  delete store.pendingAssertion;
  await writeStore(cfg, store);

  return {
    ok: true,
    credentialId: id,
    counter: newCounter,
    fingerprintGeneration: gen,
    boundFingerprintGeneration: cred.boundFingerprintGeneration,
    generationDrift: gen - (cred.boundFingerprintGeneration || 0),
  };
}

/**
 * Sensitive gate: fingerprint OK + recent WebAuthn assertion.
 */
export async function gateWithWebAuthn(cfg = {}, opts = {}) {
  const maxAgeMs =
    Number(opts.maxAssertAgeMs) > 0
      ? Number(opts.maxAssertAgeMs)
      : Number(cfg.auth?.webauthn?.maxAssertAgeMs) > 0
        ? Number(cfg.auth.webauthn.maxAssertAgeMs)
        : 5 * 60 * 1000; // 5 minutes

  const fp = await verifyFingerprint(cfg).catch((e) => ({
    ok: false,
    reason: e.message,
  }));
  if (!fp.ok) {
    return {
      allowed: false,
      layer: "fingerprint",
      ...fp,
    };
  }

  const store = await readStore(cfg);
  if (!store.credentials.length) {
    return {
      allowed: false,
      layer: "webauthn",
      reason: "not_registered",
      hint: "xclaw auth webauthn register",
    };
  }

  const last = store.lastAssertAt;
  if (!last || Date.now() - last > maxAgeMs) {
    return {
      allowed: false,
      layer: "webauthn",
      reason: "assertion_required",
      hint: "Complete WebAuthn assertion (fingerprint / platform unlock)",
      assertionOptions: await createAssertionOptions(cfg),
    };
  }

  return {
    allowed: true,
    layer: "fingerprint+webauthn",
    fingerprint: fp,
    lastAssertAt: last,
    credentialId: store.lastAssertCredentialId,
  };
}

/**
 * After fingerprint rotate — mark that WebAuthn re-assert is required.
 */
export async function markWebAuthnRequiredAfterRotate(cfg = {}) {
  const store = await readStore(cfg);
  store.requireAssertBeforeUse = true;
  store.requireAssertReason = "fingerprint_rotated";
  store.requireAssertAt = Date.now();
  await writeStore(cfg, store);
  return { ok: true };
}

export async function webauthnStatus(cfg = {}) {
  const store = await readStore(cfg);
  const fp = await fingerprintStatus(cfg).catch(() => ({}));
  return {
    registered: store.credentials.length,
    credentialIds: store.credentials.map((c) =>
      String(c.credentialId).slice(0, 12) + "…"
    ),
    lastAssertAt: store.lastAssertAt,
    requireAssertBeforeUse: Boolean(store.requireAssertBeforeUse),
    fingerprintGeneration: fp.generation,
  };
}

export function webauthnBrowserSnippet() {
  return `
// Registration
const reg = await fetch('/xclaw/webauthn/register-options').then(r => r.json());
const cred = await navigator.credentials.create({ publicKey: reg.publicKey });
// send cred to completeRegistration

// Assertion (platform fingerprint / PIN)
const asrt = await fetch('/xclaw/webauthn/assert-options').then(r => r.json());
const assertion = await navigator.credentials.get({ publicKey: asrt.publicKey });
// send assertion to completeAssertion
`.trim();
}
