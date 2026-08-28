/**
 * The assertion half of `xclaw auth webauthn` verified everything about an
 * assertion EXCEPT the signature: challenge match, counter, fingerprint
 * generation — then stamped lastAssertAt, which is the only thing
 * gateWithWebAuthn consults. The word "signature" appeared in the module
 * twice, both in comments.
 *
 * It failed closed in the field only because registration had no invocable
 * path either, so no credential could exist to assert against. Wiring the
 * missing command — the obvious fix — would have turned a dead feature into a
 * live bypass. So verification lands first, using verifyEs256Raw, which was
 * already implemented and tested in this same directory with no importer.
 *
 * These sign with a real P-256 key over authData || SHA256(clientDataJSON),
 * which is what an authenticator signs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  createRegistrationOptions,
  completeRegistration,
  createAssertionOptions,
  completeAssertion,
} from "../src/auth/webauthn.mjs";

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const CRED = "cred-real-1";

async function freshCfg() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-wa-sig-"));
  return { paths: { configDir: dir }, auth: { webauthn: { rpId: "localhost" } } };
}

function authData(counter) {
  const b = Buffer.alloc(37);
  crypto.createHash("sha256").update("localhost").digest().copy(b, 0);
  b[32] = 0x05; // UP | UV
  b.writeUInt32BE(counter, 33);
  return b;
}

async function register(cfg, { withKey = true } = {}) {
  const reg = await createRegistrationOptions(cfg);
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const clientData = Buffer.from(
    JSON.stringify({
      type: "webauthn.create",
      challenge: reg.publicKey.challenge,
      origin: "https://localhost",
    })
  );
  const done = await completeRegistration(cfg, {
    id: CRED,
    clientDataJSON: b64url(clientData),
    publicKey: withKey ? publicKey.export({ type: "spki", format: "pem" }) : null,
  });
  assert.equal(done.ok, true);
  return privateKey;
}

/** Mint an assertion. signedCounter !== counter produces a valid-DER signature over other bytes. */
async function assertion(cfg, privateKey, opts = {}) {
  const { counter = 7, signedCounter = null, omitSignature = false } = opts;
  const o = await createAssertionOptions(cfg);
  assert.equal(o.ok !== false, true);
  const clientData = Buffer.from(
    JSON.stringify({
      type: "webauthn.get",
      challenge: o.publicKey.challenge,
      origin: "https://localhost",
    })
  );
  const sent = authData(counter);
  const signed = authData(signedCounter == null ? counter : signedCounter);
  const toBeSigned = Buffer.concat([
    signed,
    crypto.createHash("sha256").update(clientData).digest(),
  ]);
  const out = {
    id: CRED,
    clientDataJSON: b64url(clientData),
    authenticatorData: b64url(sent),
  };
  if (!omitSignature) out.signature = b64url(crypto.sign("sha256", toBeSigned, privateKey));
  return out;
}

describe("webauthn assertion signature verification", () => {
  it("accepts a real ES256 assertion and takes the counter from authenticatorData", async () => {
    const cfg = await freshCfg();
    const key = await register(cfg);
    const fin = await completeAssertion(cfg, await assertion(cfg, key, { counter: 7 }));
    assert.equal(fin.ok, true);
    // The old code read assertion.authenticatorData?.counter — undefined for the
    // base64url string an authenticator actually sends — and fell back to
    // cred.counter + 1, so clone detection graded its own invention.
    assert.equal(fin.counter, 7);
  });

  it("rejects an assertion carrying no signature", async () => {
    const cfg = await freshCfg();
    const key = await register(cfg);
    const fin = await completeAssertion(
      cfg,
      await assertion(cfg, key, { omitSignature: true })
    );
    assert.equal(fin.ok, false);
    assert.equal(fin.code, "SIGNATURE_REQUIRED");
  });

  it("rejects a signature made over different signed data", async () => {
    const cfg = await freshCfg();
    const key = await register(cfg);
    const fin = await completeAssertion(
      cfg,
      await assertion(cfg, key, { counter: 7, signedCounter: 8 })
    );
    assert.equal(fin.ok, false);
    assert.equal(fin.code, "SIGNATURE_INVALID");
  });

  it("rejects a signature from a different key", async () => {
    const cfg = await freshCfg();
    await register(cfg);
    const other = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
    const fin = await completeAssertion(cfg, await assertion(cfg, other, { counter: 7 }));
    assert.equal(fin.ok, false);
    assert.equal(fin.code, "SIGNATURE_INVALID");
  });

  it("fails closed when the stored credential has no public key", async () => {
    const cfg = await freshCfg();
    const key = await register(cfg, { withKey: false });
    const fin = await completeAssertion(cfg, await assertion(cfg, key, { counter: 7 }));
    assert.equal(fin.ok, false);
    assert.equal(fin.code, "NO_PUBLIC_KEY");
  });

  it("does not stamp lastAssertAt when verification fails", async () => {
    const cfg = await freshCfg();
    const key = await register(cfg);
    await completeAssertion(cfg, await assertion(cfg, key, { omitSignature: true }));
    const raw = JSON.parse(
      await fs.readFile(path.join(cfg.paths.configDir, "webauthn-credentials.json"), "utf8")
    );
    // lastAssertAt is the only thing gateWithWebAuthn reads. A rejected
    // assertion that still stamped it would open the gate it just refused.
    assert.equal(raw.lastAssertAt == null, true);
  });
});
