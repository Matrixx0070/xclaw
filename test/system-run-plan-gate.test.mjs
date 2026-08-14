import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApprovalGate, resetSharedApprovalGate } from "../src/security/approvals.mjs";

describe("approval gate + systemRunPlan binding", () => {
  it("auto path returns planFingerprint for exec tools when binding on", async () => {
    const gate = createApprovalGate({
      security: {
        autoApprove: true,
        bindSystemRunPlan: true,
      },
    });
    const r = await gate.authorize("xclaw_bash", { command: "echo hi" });
    assert.equal(r.ok, true);
    assert.equal(r.mode, "auto");
    assert.ok(r.planFingerprint);
    assert.equal(typeof r.planFingerprint, "string");
    assert.equal(r.planFingerprint.length, 32);
  });

  it("pending list exposes plan fingerprint", async () => {
    const gate = createApprovalGate({
      security: {
        autoApprove: false,
        approvalPolicy: "risky",
        requireApproval: ["bash"],
        bindSystemRunPlan: true,
        approvalSlaMs: 30_000,
      },
    });
    const p = gate.authorize("bash", { command: "true" }, { timeoutMs: 60_000 });
    // poll for registration (deadline, not fixed sleep — load-flake-proof)
    const deadline = Date.now() + 10_000;
    while (gate.listPending().length < 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const list = gate.listPending();
    assert.ok(list.length >= 1);
    assert.ok(list[0].planFingerprint);
    assert.equal(list[0].plan?.tool, "bash");
    gate.decide(list[0].id, false, "cleanup");
    await p.catch(() => {});
  });

  it("policyInfo reports systemRunPlan flags", () => {
    const gate = createApprovalGate({
      security: {
        bindSystemRunPlan: true,
        requirePinnedExe: true,
        hashFileOperands: false,
      },
    });
    const info = gate.policyInfo();
    assert.equal(info.systemRunPlan.bind, true);
    assert.equal(info.systemRunPlan.requirePinnedExe, true);
  });

  it("fail-closed authorize when requirePinnedExe and unboundable", async () => {
    const gate = createApprovalGate({
      security: {
        autoApprove: false,
        approvalPolicy: "risky",
        requireApproval: ["xclaw_bash"],
        bindSystemRunPlan: true,
        requirePinnedExe: true,
      },
    });
    const r = await gate.authorize("xclaw_bash", {
      command: "/nonexistent/binary/xyz_no_such_thing_99999",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "exe_unboundable");
  });
});
