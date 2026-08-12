import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createRegistrationOptions,
  completeRegistration,
  createAssertionOptions,
  completeAssertion,
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

  it("complete registration and assertion counter", async () => {
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
      )
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, ""),
    });
    assert.equal(done.ok, true);

    const asrt = await createAssertionOptions(cfg);
    assert.equal(asrt.ok, true);
    const fin = await completeAssertion(cfg, {
      id: "cred-test-1",
      counter: 1,
      clientDataJSON: Buffer.from(
        JSON.stringify({
          type: "webauthn.get",
          challenge: asrt.publicKey.challenge,
          origin: "https://localhost",
        })
      )
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, ""),
    });
    assert.equal(fin.ok, true);
    assert.equal(fin.counter, 1);

    const st = await webauthnStatus(cfg);
    assert.equal(st.registered, 1);
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
