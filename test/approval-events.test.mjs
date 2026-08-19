import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isNewApprovalAsk, isApprovalRestate } from "../src/security/approval-events.mjs";

const ASK = {
  type: "security",
  phase: "approval_required",
  pendingId: "apr_1",
  name: "xclaw_file_write",
  args: { file_path: "/tmp/x" },
};
const RESTATE = { ...ASK, args: undefined, restate: true, timedOut: true };

describe("approval event reading", () => {
  it("treats the first emission as a fresh ask", () => {
    assert.equal(isNewApprovalAsk(ASK), true);
    assert.equal(isApprovalRestate(ASK), false);
  });

  it("treats the post-timeout re-emission as a restate, not an ask", () => {
    // both telegram and webchat shipped a bogus second prompt before this rule
    // was stated on the event itself
    assert.equal(isNewApprovalAsk(RESTATE), false);
    assert.equal(isApprovalRestate(RESTATE), true);
  });

  it("accepts events carrying `event` instead of `type` (SSE/NDJSON shape)", () => {
    assert.equal(isNewApprovalAsk({ ...ASK, type: undefined, event: "security" }), true);
    assert.equal(isApprovalRestate({ ...RESTATE, type: undefined, event: "security" }), true);
  });

  it("ignores unrelated events", () => {
    for (const ev of [
      null,
      undefined,
      {},
      { type: "security", phase: "denied" },
      { type: "tool", phase: "approval_required" },
      { type: "security", phase: "pending" },
    ]) {
      assert.equal(isNewApprovalAsk(ev), false);
      assert.equal(isApprovalRestate(ev), false);
    }
  });

  it("the two readings are mutually exclusive", () => {
    for (const ev of [ASK, RESTATE, { type: "security", phase: "denied" }]) {
      assert.equal(isNewApprovalAsk(ev) && isApprovalRestate(ev), false);
    }
  });
});
