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
// A complete, tested ES256 verifier sat in this same directory with no
// importer while the assertion path below verified no signature at all.
import { verifyEs256Raw } from "./cose-es256-verify.mjs";

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

  // §7.1 sibling of the assertion's context checks: the ceremony context —
  // type, challenge, origin — rides in clientDataJSON, so it is required
  // (a check that vanishes when the field is omitted is decorative) and each
  // field is enforced. Unchecked, an assertion response replays as a
  // registration, and a credential minted on a phishing origin registers here
  // and then gates everything from then on.
  if (!cred.clientDataJSON) {
    return { ok: false, error: "registration carries no clientDataJSON", code: "CLIENTDATA_REQUIRED" };
  }
  let cd;
  try {
    cd = JSON.parse(fromB64url(cred.clientDataJSON).toString("utf8"));
  } catch {
    return { ok: false, error: "invalid clientDataJSON" };
  }
  if (cd.type !== "webauthn.create") {
    return {
      ok: false,
      error: `clientData type is ${JSON.stringify(cd.type)}, not "webauthn.create"`,
      code: "CLIENTDATA_TYPE",
    };
  }
  if (cd.challenge !== pending.challenge) {
    return { ok: false, error: "challenge mismatch" };
  }
  const wa = waCfg(cfg);
  if (cd.origin !== wa.origin) {
    return {
      ok: false,
      error: `registration origin ${JSON.stringify(cd.origin)} is not the configured origin ${JSON.stringify(wa.origin)}`,
      code: "ORIGIN_MISMATCH",
    };
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
 * Complete assertion: ES256 signature + counter + fingerprint binding.
 *
 * The signature check is the whole point of the ceremony and was missing: this
 * verified the challenge, then stamped store.lastAssertAt, which is the only
 * thing gateWithWebAuthn consults. A caller holding a credential id and the
 * pending challenge — both printed by `auth webauthn status` and
 * `assert-options` — could open the gate without touching an authenticator.
 * It failed closed in the field only because registration had no invocable
 * path either, so no credential existed to assert against.
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

  // An authenticator signs authData || SHA256(clientDataJSON). Every one of
  // these returns BEFORE the store is touched: a rejected assertion that still
  // stamped lastAssertAt would open the gate it just refused.
  if (!assertion.signature) {
    return { ok: false, error: "assertion carries no signature", code: "SIGNATURE_REQUIRED" };
  }
  if (!assertion.authenticatorData) {
    return { ok: false, error: "assertion carries no authenticatorData", code: "AUTHDATA_REQUIRED" };
  }
  if (!assertion.clientDataJSON) {
    return { ok: false, error: "assertion carries no clientDataJSON", code: "CLIENTDATA_REQUIRED" };
  }

  // The signature proves the authenticator signed — not that it signed for
  // THIS ceremony. The ceremony context lives inside the signed payload
  // (WebAuthn L2 §7.2) and each field must be checked, or a signature obtained
  // in another context verifies here: a registration response replayed as an
  // assertion (type), a phishing page the victim's real authenticator happily
  // signed for (origin), another relying party's assertion (rpIdHash), a
  // response produced with no human present (UP flag).
  let cd;
  try {
    cd = JSON.parse(fromB64url(assertion.clientDataJSON).toString("utf8"));
  } catch {
    return { ok: false, error: "invalid clientDataJSON" };
  }
  if (cd.type !== "webauthn.get") {
    return {
      ok: false,
      error: `clientData type is ${JSON.stringify(cd.type)}, not "webauthn.get"`,
      code: "CLIENTDATA_TYPE",
    };
  }
  if (cd.challenge !== pending.challenge) {
    return { ok: false, error: "challenge mismatch" };
  }
  const wa = waCfg(cfg);
  if (cd.origin !== wa.origin) {
    return {
      ok: false,
      error: `assertion origin ${JSON.stringify(cd.origin)} is not the configured origin ${JSON.stringify(wa.origin)}`,
      code: "ORIGIN_MISMATCH",
    };
  }
  if (!cred.publicKey) {
    return {
      ok: false,
      error: "stored credential has no public key — re-register this credential",
      code: "NO_PUBLIC_KEY",
    };
  }

  const authData = fromB64url(assertion.authenticatorData);
  // rpIdHash(32) | flags(1) | signCount(4)
  if (authData.length < 37) {
    return { ok: false, error: "authenticatorData too short", code: "AUTHDATA_INVALID" };
  }
  const expectedRpIdHash = crypto.createHash("sha256").update(wa.rpId).digest();
  if (!crypto.timingSafeEqual(authData.subarray(0, 32), expectedRpIdHash)) {
    return {
      ok: false,
      error: `authenticatorData rpIdHash does not match rp id ${JSON.stringify(wa.rpId)}`,
      code: "RPID_MISMATCH",
    };
  }
  if ((authData[32] & 0x01) === 0) {
    return {
      ok: false,
      error: "user presence flag not set — the authenticator did not attest a present user",
      code: "USER_PRESENCE_REQUIRED",
    };
  }
  const toBeSigned = Buffer.concat([
    authData,
    crypto.createHash("sha256").update(fromB64url(assertion.clientDataJSON)).digest(),
  ]);
  let verified = false;
  try {
    verified = verifyEs256Raw(cred.publicKey, toBeSigned, fromB64url(assertion.signature));
  } catch (e) {
    return {
      ok: false,
      error: `assertion signature could not be verified: ${e.message}`,
      code: "SIGNATURE_INVALID",
    };
  }
  if (!verified) {
    return { ok: false, error: "assertion signature did not verify", code: "SIGNATURE_INVALID" };
  }

  // Counter must not go backwards (clone detection). This read
  // assertion.authenticatorData?.counter — undefined for the base64url string
  // an authenticator actually sends — then fell back to cred.counter + 1, so
  // clone detection was grading a number it had invented itself.
  const newCounter = authData.readUInt32BE(33);
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
  // Every line of this snippet used to be false: it fetched
  // /xclaw/webauthn/register-options and /xclaw/webauthn/assert-options, which
  // exist in no route table, and then said "send cred to completeRegistration"
  // — a function with no invocable path. It is the operator's only instruction
  // for running the ceremony, so it has to be a procedure that actually runs.
  //
  // base64url is done with replaceAll rather than regex literals on purpose: a
  // backslash inside this template literal is an escape sequence, so a /\+/ in
  // here reaches the operator's console as /+/ and does not run.
  return `
// 1. In a terminal:  xclaw auth webauthn register-options > /tmp/reg.json
// 2. Paste that JSON as \`reg\` in the browser console on your rp origin:
const cred = await navigator.credentials.create({ publicKey: reg.publicKey });
const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)))
  .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
copy(JSON.stringify({
  id: cred.id,
  clientDataJSON: b64(cred.response.clientDataJSON),
  publicKey: cred.response.getPublicKey
    ? b64(cred.response.getPublicKey())   // SPKI — xclaw verifies ES256 with it
    : null,
}));
// 3. Back in the terminal:  pbpaste | xclaw auth webauthn register -

// Assertion (platform fingerprint / PIN)
// 1.  xclaw auth webauthn assert-options > /tmp/asrt.json
// 2. Paste that JSON as \`asrt\`:
const a = await navigator.credentials.get({ publicKey: asrt.publicKey });
copy(JSON.stringify({
  id: a.id,
  authenticatorData: b64(a.response.authenticatorData),
  clientDataJSON: b64(a.response.clientDataJSON),
  signature: b64(a.response.signature),
}));
// 3.  pbpaste | xclaw auth webauthn assert -
`.trim();
}
