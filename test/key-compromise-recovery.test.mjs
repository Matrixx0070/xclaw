import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  ensureKeyStore,
  signWithCurrentKey,
  rotateKeys,
} from "../src/auth/key-rotation.mjs";
import {
  recoverFromCompromise,
  verifyWithRecovery,
  assertCanSign,
  quarantineKeys,
  recoveryStatus,
} from "../src/auth/key-compromise-recovery.mjs";

describe("key compromise recovery", () => {
  async function tmpCfg() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-kcr-"));
    return {
      paths: { configDir: dir },
      auth: {
        keys: {
          secret: "recovery-test-secret!",
          rotationStrategy: "dual_slot",
          dualWindowMs: 60_000,
          autoRotate: false,
        },
      },
    };
  }

  it("recoverFromCompromise rotates and revokes old kid", async () => {
    const cfg = await tmpCfg();
    await ensureKeyStore(cfg);
    const { signature, kid: oldKid } = await signWithCurrentKey(cfg, "secret-msg");
    const r = await recoverFromCompromise(cfg, { reason: "test_leak" });
    assert.equal(r.ok, true);
    assert.notEqual(r.newKid, oldKid);
    assert.ok(r.revokedKids.includes(oldKid));

    const v = await verifyWithRecovery(cfg, "secret-msg", signature);
    assert.equal(v.ok, false);
    assert.equal(v.code, "KEY_REVOKED");
  });

  it("quarantine blocks assertCanSign", async () => {
    const cfg = await tmpCfg();
    await ensureKeyStore(cfg);
    await quarantineKeys(cfg, "test");
    await assert.rejects(() => assertCanSign(cfg), (e) => e.code === "QUARANTINED");
    const st = await recoveryStatus(cfg);
    assert.equal(st.quarantined, true);
  });

  it("new signatures work after recovery", async () => {
    const cfg = await tmpCfg();
    await ensureKeyStore(cfg);
    await recoverFromCompromise(cfg, { reason: "test" });
    const { signature, kid } = await signWithCurrentKey(cfg, "fresh");
    const v = await verifyWithRecovery(cfg, "fresh", signature);
    assert.equal(v.ok, true);
    assert.equal(v.kid, kid);
  });
});
