import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authorizeToolCall,
  policyFromAuth,
  emitAuthDecision,
} from "../src/agent/secure-tool-call.mjs";
import { createApprovalGate } from "../src/security/approvals.mjs";

describe("secure-tool-call helper", () => {
  it("policyFromAuth carries planFingerprint", () => {
    const p = policyFromAuth(
      {
        ok: true,
        mode: "human",
        planFingerprint: "abc123def456abc123def456abc123de",
        plan: { tool: "bash", command: "echo x", fingerprint: "abc123def456abc123def456abc123de" },
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
});
