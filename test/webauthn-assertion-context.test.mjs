/**
 * WebAuthn §7.2: an assertion's signature proves the AUTHENTICATOR signed,
 * not that it signed for THIS ceremony. The signed payload itself carries the
 * ceremony context — clientData.type, clientData.origin, authData.rpIdHash,
 * the user-presence flag — and each must be checked, or a signature obtained
 * in another context verifies here:
 *
 *   - type unchecked: a "webauthn.create" (registration) response replays as
 *     an assertion — cross-protocol confusion.
 *   - origin unchecked: a phishing page's assertion — which the victim's real
 *     authenticator happily signs, over clientData naming the evil origin —
 *     opens the gate.
 *   - rpIdHash unchecked: an assertion scoped to a different relying party
 *     verifies against this one.
 *   - UP flag unchecked: a response produced with no human present passes a
 *     gate whose purpose is proving a human is present.
 *
 * Before this fix, all four forgeries below were ACCEPTED (measured): only
 * challenge, signature and counter were checked.
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
const CRED = "cred-ctx-1";

async function freshCfg() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-wa-ctx-"));
  return { paths: { configDir: dir }, auth: { webauthn: { rpId: "localhost", origin: "https://localhost" } } };
}

function authData({ rpId = "localhost", flags = 0x05, counter = 1 } = {}) {
  const b = Buffer.alloc(37);
  crypto.createHash("sha256").update(rpId).digest().copy(b, 0);
  b[32] = flags;
  b.writeUInt32BE(counter, 33);
  return b;
}

async function registered(cfg) {
  const reg = await createRegistrationOptions(cfg);
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const clientData = Buffer.from(
    JSON.stringify({ type: "webauthn.create", challenge: reg.publicKey.challenge, origin: "https://localhost" })
  );
  const done = await completeRegistration(cfg, {
    id: CRED,
    clientDataJSON: b64url(clientData),
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  });
  assert.equal(done.ok, true);
  return privateKey;
}

function signAssertion(privateKey, { clientData, authDataBuf }) {
  const cdBuf = Buffer.from(JSON.stringify(clientData));
  const toSign = Buffer.concat([authDataBuf, crypto.createHash("sha256").update(cdBuf).digest()]);
  const signature = crypto.sign("sha256", toSign, { key: privateKey, dsaEncoding: "der" });
  return {
    id: CRED,
    clientDataJSON: b64url(cdBuf),
    authenticatorData: b64url(authDataBuf),
    signature: b64url(signature),
  };
}

async function attempt(mutate) {
  const cfg = await freshCfg();
  const privateKey = await registered(cfg);
  const opts = await createAssertionOptions(cfg);
  const base = {
    clientData: { type: "webauthn.get", challenge: opts.publicKey.challenge, origin: "https://localhost" },
    authDataBuf: authData(),
  };
  const out = await completeAssertion(cfg, signAssertion(privateKey, mutate(base)));
  return out;
}

describe("assertion context is verified, not just the signature", () => {
  it("a well-formed assertion still passes", async () => {
    const out = await attempt((b) => b);
    assert.equal(out.ok, true, out.error);
  });

  it("refuses a registration-type clientData replayed as an assertion", async () => {
    const out = await attempt((b) => ({ ...b, clientData: { ...b.clientData, type: "webauthn.create" } }));
    assert.equal(out.ok, false, "a webauthn.create response opened the assertion gate");
    assert.match(out.error || "", /type/i);
  });

  it("refuses an assertion signed for another origin", async () => {
    const out = await attempt((b) => ({ ...b, clientData: { ...b.clientData, origin: "https://evil.example" } }));
    assert.equal(out.ok, false, "a phishing origin's assertion opened the gate");
    assert.match(out.error || "", /origin/i);
  });

  it("refuses an assertion scoped to a different relying party", async () => {
    const out = await attempt((b) => ({ ...b, authDataBuf: authData({ rpId: "other.example" }) }));
    assert.equal(out.ok, false, "another RP's rpIdHash opened the gate");
    assert.match(out.error || "", /rp/i);
  });

  it("refuses an assertion without user presence", async () => {
    const out = await attempt((b) => ({ ...b, authDataBuf: authData({ flags: 0x00 }) }));
    assert.equal(out.ok, false, "an assertion with no human present opened the gate");
    assert.match(out.error || "", /presence/i);
  });
});
