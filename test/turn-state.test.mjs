import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  inferGoal,
  buildTurnProgress,
  applyClosureToProgress,
  formatBlockedReply,
  buildTurnState,
  isTurnBlocked,
} from "../src/agent/turn-state.mjs";

describe("turn-state", () => {
  it("infers implement vs question goals", () => {
    assert.equal(inferGoal("Implement chunk overflow").type, "implement");
    assert.equal(inferGoal("What is JWKS?").type, "question");
    assert.equal(inferGoal("Fix the failing tests").type, "fix");
  });

  it("progress blocked on pending approval", () => {
    const p = buildTurnProgress({
      toolTrace: [
        {
          name: "xclaw_bash",
          status: "blocked",
          policy: { phase: "approval", decision: "pending", reason: "pending" },
          outcome: { kind: "permission", summary: "awaiting approval" },
        },
      ],
      pendingApproval: { id: "apr_1", tool: "xclaw_bash" },
      turns: 1,
      finalText: "waiting",
    });
    assert.equal(p.phase, "blocked");
    assert.ok(p.blockers.some((b) => b.type === "approval"));
  });

  it("applyClosure marks done", () => {
    let p = buildTurnProgress({
      toolTrace: [{ name: "xclaw_file_write", status: "ok", artifacts: [] }],
      turns: 2,
      finalText: "Done. Implemented.",
    });
    p = applyClosureToProgress(p, { closed: true, confidence: 0.85, reason: "action_done" });
    assert.equal(p.phase, "done");
  });

  it("formatBlockedReply is actionable", () => {
    const s = formatBlockedReply({
      tool: "xclaw_bash",
      reason: "pending",
      pendingId: "apr_9",
      argsPreview: '{"command":"rm -rf /"}',
    });
    assert.match(s, /Approval required/);
    assert.match(s, /apr_9/);
    assert.match(s, /xclaw_bash/);
  });

  it("buildTurnState summary + isTurnBlocked", () => {
    const ts = buildTurnState({
      userMessage: "run deploy",
      toolTrace: [
        {
          name: "xclaw_bash",
          status: "blocked",
          policy: { decision: "pending", pendingId: "p1" },
        },
      ],
      pendingApproval: { id: "p1", tool: "xclaw_bash" },
      turns: 1,
      finalText: "need approval",
      closure: { closed: false, confidence: 0.9, reason: "blocked" },
    });
    assert.equal(ts.phase, "blocked");
    assert.ok(isTurnBlocked(ts));
    assert.match(ts.summary, /phase=blocked/);
  });
});
