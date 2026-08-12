import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authorizeToolCall,
  policyFromAuth,
  emitAuthDecision,
  authorizeToolInLoop,
} from "../src/agent/secure-tool-call.mjs";
import { createApprovalGate } from "../src/security/approvals.mjs";

describe("secure-tool-call helper", () => {
  it("policyFromAuth carries planFingerprint", () => {
    const p = policyFromAuth(
      {
        ok: true,
        mode: "human",
        planFingerprint: "abc123def456abc123def456abc123de",
        plan: {
          tool: "bash",
          command: "echo x",
          fingerprint: "abc123def456abc123def456abc123de",
        },
      },
      "allow"
    );
    assert.equal(p.decision, "allow");
    assert.equal(p.planFingerprint, "abc123def456abc123def456abc123de");
    assert.equal(p.plan.tool, "bash");
  });

  it("authorizeToolCall attaches fingerprint on auto path", async () => {
    const gate = createApprovalGate({
      security: { autoApprove: true, bindSystemRunPlan: true },
    });
    const events = [];
    const auth = await authorizeToolCall({
      approvalGate: gate,
      name: "xclaw_bash",
      args: { command: "echo helper" },
      cfg: { security: {} },
      onEvent: (e) => events.push(e),
    });
    assert.equal(auth.ok, true);
    assert.ok(auth.planFingerprint);
    assert.equal(auth.planFingerprint.length, 32);
  });

  it("emitAuthDecision includes plan fields", () => {
    const events = [];
    emitAuthDecision({
      onEvent: (e) => events.push(e),
      name: "bash",
      auth: {
        mode: "human",
        planFingerprint: "deadbeefdeadbeefdeadbeefdeadbeef",
        note: "ok",
      },
      phase: "approved",
    });
    assert.equal(events[0].phase, "approved");
    assert.equal(events[0].planFingerprint, "deadbeefdeadbeefdeadbeefdeadbeef");
  });

  it("authorizeToolInLoop auto path returns allow policy with fingerprint", async () => {
    const gate = createApprovalGate({
      security: { autoApprove: true, bindSystemRunPlan: true },
    });
    const events = [];
    const out = await authorizeToolInLoop({
      approvalGate: gate,
      name: "xclaw_bash",
      args: { command: "echo loop-gate" },
      cfg: { security: {} },
      onEvent: (e) => events.push(e),
      formatBlockedReply: () => "blocked",
    });
    assert.equal(out.allowed, true);
    assert.ok(out.policy);
    assert.equal(out.policy.decision, "allow");
    assert.ok(out.policy.planFingerprint);
    assert.equal(out.policy.planFingerprint.length, 32);
  });

  it("authorizeToolInLoop deny path surfaces plan on events", async () => {
    const gate = createApprovalGate({
      security: {
        autoApprove: false,
        approvalPolicy: "risky",
        requireApproval: ["bash"],
        bindSystemRunPlan: true,
        approvalSlaMs: 50,
        approvalSlaAction: "deny",
      },
    });
    const events = [];
    const out = await authorizeToolInLoop({
      approvalGate: gate,
      name: "bash",
      args: { command: "echo will-timeout" },
      cfg: { security: { approvalTimeoutMs: 80 } },
      onEvent: (e) => events.push(e),
      formatBlockedReply: ({ tool, pendingId }) =>
        `blocked:${tool}:${pendingId || ""}`,
    });
    assert.equal(out.allowed, false);
    assert.ok(out.policy);
    assert.ok(["deny", "pending"].includes(out.policy.decision));
  });
});
