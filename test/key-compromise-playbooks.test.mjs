import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ensureKeyStore, rotateKeys, signWithCurrentKey } from "../src/auth/key-rotation.mjs";
import {
  listPlaybooks,
  recommendPlaybook,
  runPlaybook,
} from "../src/auth/key-compromise-playbooks.mjs";
import { verifyWithRecovery } from "../src/auth/key-compromise-recovery.mjs";

describe("compromise recovery playbooks", () => {
  async function tmpCfg() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-pb-"));
    return {
      paths: { configDir: dir },
      auth: {
        keys: {
          secret: "playbook-test-secret!",
          rotationStrategy: "dual_slot",
          dualWindowMs: 60_000,
          autoRotate: false,
        },
      },
    };
  }

  it("lists playbooks", () => {
    const list = listPlaybooks();
    assert.ok(list.length >= 5);
    assert.ok(list.some((p) => p.id === "current_leak"));
  });

  it("recommendPlaybook maps signals", () => {
    assert.equal(recommendPlaybook({ hostCompromise: true }), "full_host");
    assert.equal(recommendPlaybook({ previousKeyLeaked: true }), "previous_leak");
    assert.equal(recommendPlaybook({ suspectOnly: true }), "soft_suspect");
  });

  it("dryRun does not rotate", async () => {
    const cfg = await tmpCfg();
    await ensureKeyStore(cfg);
    const before = await ensureKeyStore(cfg);
    const report = await runPlaybook(cfg, "current_leak", { dryRun: true });
    assert.equal(report.ok, true);
    assert.equal(report.dryRun, true);
    const after = await ensureKeyStore(cfg);
    assert.equal(after.generation, before.generation);
  });

  it("previous_leak closes window and revokes previous", async () => {
    const cfg = await tmpCfg();
    await ensureKeyStore(cfg);
    const { signature, kid: oldKid } = await signWithCurrentKey(cfg, "msg");
    await rotateKeys(cfg);
    const report = await runPlaybook(cfg, "previous_leak", {
      reason: "test_prev",
    });
    assert.equal(report.ok, true);
    const v = await verifyWithRecovery(cfg, "msg", signature);
    assert.equal(v.ok, false);
    assert.equal(v.code, "KEY_REVOKED");
    assert.ok(oldKid);
  });

  it("current_leak issues new kid", async () => {
    const cfg = await tmpCfg();
    const st = await ensureKeyStore(cfg);
    const report = await runPlaybook(cfg, "current_leak", { reason: "test" });
    assert.equal(report.ok, true);
    const after = await ensureKeyStore(cfg);
    assert.notEqual(after.kid, st.kid);
  });
});
