import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSystemRunPlan,
  revalidatePlan,
  planFingerprint,
  isExecTool,
} from "../src/security/system-run-plan.mjs";
import { createApprovalGate } from "../src/security/approvals.mjs";

describe("plan revalidation enforcement", () => {
  it("isExecTool recognizes xclaw_bash", () => {
    assert.equal(isExecTool("xclaw_bash"), true);
    assert.equal(isExecTool("xclaw_file_read"), false);
  });

  it("revalidatePlan ok for fresh plan", () => {
    const built = buildSystemRunPlan({
      tool: "xclaw_bash",
      args: { command: "echo ok" },
      root: process.cwd(),
    });
    assert.equal(built.ok, true);
    const rv = revalidatePlan(built.plan);
    assert.equal(rv.ok, true);
  });

  it("revalidatePlan fails on fingerprint tamper", () => {
    const built = buildSystemRunPlan({
      tool: "xclaw_bash",
      args: { command: "echo ok" },
      root: process.cwd(),
    });
    assert.equal(built.ok, true);
    const plan = { ...built.plan, fingerprint: "0".repeat(32) };
    const rv = revalidatePlan(plan);
    assert.equal(rv.ok, false);
    assert.equal(rv.reason, "fingerprint_mismatch");
  });

  it("approval gate returns plan for auto exec", async () => {
    const gate = createApprovalGate({
      security: { autoApprove: true, bindSystemRunPlan: true },
    });
    const r = await gate.authorize("xclaw_bash", { command: "echo hi" });
    assert.equal(r.ok, true);
    assert.ok(r.plan);
    assert.ok(r.planFingerprint);
    const rv = revalidatePlan(r.plan);
    assert.equal(rv.ok, true);
    assert.equal(planFingerprint(r.plan), r.planFingerprint);
  });
});
