/**
 * Feature 1 — approval decide codes + concurrent approve
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createApprovalGate,
  resetSharedApprovalGate,
  listPendingApprovals,
  decideApproval,
} from "../src/security/approvals.mjs";

const baseCfg = () => ({
  security: {
    autoApprove: false,
    approvalPolicy: "risky",
    requireApproval: ["bash", "xclaw_bash"],
    // Avoid plan bind failures in unit tests without real exe pins
    bindSystemRunPlan: false,
  },
});

describe("approval inbox", () => {
  beforeEach(() => {
    resetSharedApprovalGate(baseCfg());
  });

  it("decide unknown → APPROVAL_NOT_FOUND", () => {
    const gate = createApprovalGate(baseCfg());
    const out = gate.decide("nope", true);
    assert.equal(out.ok, false);
    assert.equal(out.code, "APPROVAL_NOT_FOUND");
  });

  it("authorize pending then approve via onPending", async () => {
    const gate = createApprovalGate(baseCfg());
    const p = gate.authorize(
      "bash",
      { command: "echo hi" },
      {
        timeoutMs: 5000,
        onPending: ({ id }) => {
          setTimeout(() => gate.decide(id, true, "ok"), 10);
        },
      }
    );
    // briefly list while pending
    await new Promise((r) => setTimeout(r, 5));
    const result = await p;
    assert.equal(result.ok, true);
    assert.equal(result.approved, true);
    assert.ok(result.pendingId);
    assert.equal(gate.listPending().length, 0);
  });

  it("deny resolves with denied", async () => {
    const gate = createApprovalGate(baseCfg());
    const result = await gate.authorize(
      "bash",
      { command: "rm -rf /" },
      {
        timeoutMs: 5000,
        onPending: ({ id }) => {
          gate.decide(id, false, "too dangerous");
        },
      }
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "denied");
  });

  it("shared helpers list + decide", () => {
    const cfg = baseCfg();
    resetSharedApprovalGate(cfg);
    const out = decideApproval(cfg, "missing", true);
    assert.equal(out.code, "APPROVAL_NOT_FOUND");
    assert.deepEqual(listPendingApprovals(cfg), []);
  });
});
