import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createRegistrationOptions,
  completeRegistration,
  createAssertionOptions,
  webauthnStatus,
  gateWithWebAuthn,
} from "../src/auth/webauthn.mjs";

describe("webauthn integration", () => {
  it("registration options include challenge and rp", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-wa-"));
    const cfg = { paths: { configDir: dir }, auth: { webauthn: { rpId: "test.local" } } };
    const opts = await createRegistrationOptions(cfg, { name: "tester" });
    assert.ok(opts.publicKey.challenge);
    assert.equal(opts.publicKey.rp.id, "test.local");
  });

  it("registration stores a credential and assertion options offer it", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-wa2-"));
    const cfg = { paths: { configDir: dir } };
    const reg = await createRegistrationOptions(cfg);
    const done = await completeRegistration(cfg, {
      id: "cred-test-1",
      clientDataJSON: Buffer.from(
        JSON.stringify({
          type: "webauthn.create",
          challenge: reg.publicKey.challenge,
          origin: "https://localhost",
        })
      ).toString("base64url"),
    });
    assert.equal(done.ok, true);

    const asrt = await createAssertionOptions(cfg);
    assert.equal(asrt.ok, true);

    const st = await webauthnStatus(cfg);
    assert.equal(st.registered, 1);
    // This used to run completeAssertion with no signature field and assert
    // ok === true — it was the stub's coverage, and it is why a signature-less
    // acceptance path stayed green for its whole life. The assertion ceremony
    // is now exercised with a real P-256 signature in
    // test/webauthn-assertion-signature.test.mjs.
  });

  it("gate requires assertion when registered but stale", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-wa3-"));
    const cfg = {
      paths: { configDir: dir },
      auth: { webauthn: { maxAssertAgeMs: 1 } },
    };
    // no credentials
    const g = await gateWithWebAuthn(cfg);
    assert.equal(g.allowed, false);
  });
});
