import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  ensureKeyStore,
  rotateKeys,
  evaluateKeyRotation,
  signWithCurrentKey,
  verifyWithRotatedKeys,
  getVerificationKeys,
  keyRotationStatus,
} from "../src/auth/key-rotation.mjs";

describe("automated key rotation", () => {
  async function tmpCfg(extra = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-kr-"));
    return {
      paths: { configDir: dir },
      auth: {
        keys: {
          secret: "test-key-secret-16chars",
          rotationStrategy: "dual_slot",
          dualWindowMs: 60_000,
          autoRotate: false,
          ...extra,
        },
      },
    };
  }

  it("ensure creates generation 1", async () => {
    const cfg = await tmpCfg();
    const st = await ensureKeyStore(cfg);
    assert.equal(st.generation, 1);
    assert.ok(st.kid);
    assert.equal(st.publicJwk.crv, "P-256");
  });

  it("rotate bumps generation and opens dual window", async () => {
    const cfg = await tmpCfg();
    await ensureKeyStore(cfg);
    const r = await rotateKeys(cfg, { reason: "test" });
    assert.equal(r.ok, true);
    assert.equal(r.generation, 2);
    const keys = await getVerificationKeys(cfg);
    assert.equal(keys.length, 2);
    const st = await keyRotationStatus(cfg);
    assert.equal(st.dualWindow.open, true);
  });

  it("sign and verify with current key", async () => {
    const cfg = await tmpCfg();
    await ensureKeyStore(cfg);
    const { signature, kid } = await signWithCurrentKey(cfg, "hello");
    const v = await verifyWithRotatedKeys(cfg, "hello", signature);
    assert.equal(v.ok, true);
    assert.equal(v.kid, kid);
    assert.equal(v.current, true);
  });

  it("previous key still verifies inside dual window", async () => {
    const cfg = await tmpCfg();
    await ensureKeyStore(cfg);
    const { signature } = await signWithCurrentKey(cfg, "old-msg");
    await rotateKeys(cfg);
    const v = await verifyWithRotatedKeys(cfg, "old-msg", signature);
    assert.equal(v.ok, true);
    assert.equal(v.current, false);
  });

  it("budget strategy requests rotate at maxUses", async () => {
    const cfg = await tmpCfg({
      rotationStrategy: "budget",
      maxUses: 2,
      autoRotate: false,
    });
    await ensureKeyStore(cfg);
    await signWithCurrentKey(cfg, "a");
    await signWithCurrentKey(cfg, "b");
    const ev = await evaluateKeyRotation(cfg);
    assert.equal(ev.action, "rotate");
    assert.equal(ev.reason, "max_uses");
  });

  it("closeDualWindow stops previous verify", async () => {
    const { closeDualWindow, dualWindowStatus } = await import(
      "../src/auth/key-rotation.mjs"
    );
    const cfg = await tmpCfg();
    await ensureKeyStore(cfg);
    const { signature } = await signWithCurrentKey(cfg, "msg");
    await rotateKeys(cfg);
    assert.equal((await dualWindowStatus(cfg)).open, true);
    await closeDualWindow(cfg);
    assert.equal((await dualWindowStatus(cfg)).open, false);
    const v = await verifyWithRotatedKeys(cfg, "msg", signature);
    assert.equal(v.ok, false);
  });

  it("extendDualWindow increases remaining", async () => {
    const { extendDualWindow, dualWindowStatus } = await import(
      "../src/auth/key-rotation.mjs"
    );
    const cfg = await tmpCfg({ dualWindowMs: 5_000 });
    await ensureKeyStore(cfg);
    await rotateKeys(cfg, { dualWindowMs: 5_000 });
    const before = await dualWindowStatus(cfg);
    const ext = await extendDualWindow(cfg, 30_000);
    assert.equal(ext.ok, true);
    const after = await dualWindowStatus(cfg);
    assert.ok(after.remainingMs > before.remainingMs);
  });
});
