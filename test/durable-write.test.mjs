import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  durableAtomicWrite,
  durableAtomicWriteJson,
  durableWritesEnabled,
} from "../src/utils/durable-write.mjs";
import { ensureKeyStore, rotateKeys } from "../src/auth/key-rotation.mjs";
import { publishJwksInvalidation, getInvalidationEpoch } from "../src/auth/jwks-invalidation.mjs";
import { quarantineKeys, recoveryStatus } from "../src/auth/key-compromise-recovery.mjs";

describe("durable atomic writes", () => {
  it("writes and reads JSON atomically", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-dur-"));
    const p = path.join(dir, "t.json");
    await durableAtomicWriteJson(p, { a: 1 }, { durable: true });
    const body = JSON.parse(await fs.readFile(p, "utf8"));
    assert.equal(body.a, 1);
    const st = await fs.stat(p);
    // mode may be masked by umask; at least file exists and is regular
    assert.ok(st.isFile());
  });

  it("durableWritesEnabled respects cfg and env", () => {
    assert.equal(durableWritesEnabled({}), true);
    assert.equal(durableWritesEnabled({ auth: { durableWrites: false } }), false);
  });

  it("key-rotation store survives write path", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-dur-kr-"));
    const cfg = {
      paths: { configDir: dir },
      auth: {
        durableWrites: true,
        keys: {
          secret: "durable-test-secret!!",
          rotationStrategy: "dual_slot",
          dualWindowMs: 60_000,
          autoRotate: false,
        },
      },
    };
    const st = await ensureKeyStore(cfg);
    assert.ok(st.kid);
    await rotateKeys(cfg, { reason: "dur_test" });
    const raw = JSON.parse(
      await fs.readFile(path.join(dir, "key-rotation.json"), "utf8")
    );
    assert.ok(raw.generation >= 2);
  });

  it("epoch and recovery use durable path", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-dur-ep-"));
    const cfg = {
      paths: { configDir: dir },
      auth: {
        durableWrites: true,
        keys: { secret: "dur-ep-secret!!!!!!!!", autoRotate: false },
        jwks: { distributedInvalidation: true },
      },
    };
    await ensureKeyStore(cfg);
    await publishJwksInvalidation(cfg, { reason: "dur" });
    const ep = await getInvalidationEpoch(cfg);
    assert.ok(ep.epoch >= 1);
    await quarantineKeys(cfg, "dur_test");
    const rec = await recoveryStatus(cfg);
    assert.equal(rec.quarantined, true);
  });
});
