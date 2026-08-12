import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { importWebSession } from "../src/auth/web-login.mjs";
import {
  bindAfterImport,
  evaluateRotation,
  recordSessionUse,
  rotateWebSession,
  cookieFingerprint,
} from "../src/auth/cookie-rotation.mjs";

describe("cookie rotation", () => {
  it("budget strategy tracks uses", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-rot-"));
    const cfg = {
      paths: { configDir: dir },
      auth: {
        web: {
          sessionSecret: "rotation-test-secret-16+",
          rotationStrategy: "budget",
          maxUses: 3,
          maxAgeMs: 86400000,
        },
      },
    };
    await importWebSession(cfg, { cookie: "session=rotatetest1" });
    await bindAfterImport(cfg);
    await recordSessionUse(cfg);
    await recordSessionUse(cfg);
    const ev = await evaluateRotation(cfg);
    assert.equal(ev.ok, true);
    await recordSessionUse(cfg);
    const ev2 = await evaluateRotation(cfg);
    assert.equal(ev2.ok, false);
    assert.equal(ev2.reason, "max_uses");
  });

  it("rotate bumps generation", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-rot2-"));
    const cfg = {
      paths: { configDir: dir },
      auth: {
        web: {
          sessionSecret: "rotation-test-secret-16+",
          rotationStrategy: "dual_slot",
        },
      },
    };
    await importWebSession(cfg, { cookie: "session=abc" });
    await bindAfterImport(cfg);
    const r = await rotateWebSession(cfg, { keepPrevious: true });
    assert.equal(r.ok, true);
    assert.equal(r.generation, 1);
  });

  it("fingerprint is stable", () => {
    const a = cookieFingerprint({ cookie: "x=1" });
    const b = cookieFingerprint({ cookie: "x=1" });
    const c = cookieFingerprint({ cookie: "x=2" });
    assert.equal(a, b);
    assert.notEqual(a, c);
  });
});
