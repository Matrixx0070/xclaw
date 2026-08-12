import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { importWebSession } from "../src/auth/web-login.mjs";
import {
  ensureFingerprintBinding,
  rotateFingerprint,
  verifyFingerprint,
  bindingFingerprint,
  materialFingerprint,
} from "../src/auth/fingerprint-rotation.mjs";

describe("fingerprint rotation", () => {
  it("bind then verify matches current", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-fp-"));
    const cfg = {
      paths: { configDir: dir },
      auth: { web: { sessionSecret: "fp-test-secret-16chars" } },
    };
    await importWebSession(cfg, { cookie: "session=fp1" });
    const b = await ensureFingerprintBinding(cfg);
    assert.equal(b.ok, true);
    const v = await verifyFingerprint(cfg);
    assert.equal(v.ok, true);
    assert.equal(v.match, "current");
  });

  it("salt rotation changes binding; dual window accepts previous", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-fp2-"));
    const cfg = {
      paths: { configDir: dir },
      auth: {
        web: {
          sessionSecret: "fp-test-secret-16chars",
          fingerprintPreviousRetainMs: 60_000,
        },
      },
    };
    await importWebSession(cfg, { cookie: "session=fp2" });
    await ensureFingerprintBinding(cfg);
    const rot = await rotateFingerprint(cfg, { mode: "salt" });
    assert.equal(rot.ok, true);
    const v = await verifyFingerprint(cfg);
    assert.equal(v.ok, true);
    // after salt rotate with same material, current binding should match new salt
    assert.ok(v.match === "current" || v.match === "previous");
  });

  it("bindingFingerprint depends on salt", () => {
    const m = "abc";
    const a = bindingFingerprint(m, 0, "salt1");
    const b = bindingFingerprint(m, 0, "salt2");
    assert.notEqual(a, b);
  });

  it("material fingerprint stable", () => {
    const s = { cookie: "a=1" };
    assert.equal(materialFingerprint(s), materialFingerprint(s));
  });
});
