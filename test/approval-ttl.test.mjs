/**
 * Approval TTL — critical never auto-approves on timeout.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isCriticalRisk,
  resolveSlaAction,
  resolveExpiredApproval,
  isApprovalExpired,
  approvalDeadline,
} from "../src/security/approval-ttl.mjs";

describe("approval TTL policy", () => {
  it("flags critical tiers", () => {
    assert.equal(isCriticalRisk("critical"), true);
    assert.equal(isCriticalRisk({ tier: "high" }), true);
    assert.equal(isCriticalRisk({ rank: 3 }), true);
    assert.equal(isCriticalRisk("low"), false);
  });

  it("forces deny for critical even when slaAction=approve", () => {
    assert.equal(
      resolveSlaAction({ risk: "critical", slaAction: "approve" }, {}),
      "deny"
    );
    assert.equal(
      resolveSlaAction({ risk: "low", slaAction: "approve" }, {}),
      "approve"
    );
    assert.equal(
      resolveSlaAction({ risk: "low", slaAction: "approve" }, {
        security: { approvalSlaNeverApprove: true },
      }),
      "deny"
    );
  });

  it("resolveExpiredApproval auto-deny critical", () => {
    const r = resolveExpiredApproval(
      { tool: "xclaw_bash", risk: { tier: "critical" }, slaAction: "approve" },
      {}
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, "sla_timeout_critical");
  });

  it("deadline expiry helpers", () => {
    const now = 1_000_000;
    const d = approvalDeadline(5_000, now);
    assert.equal(d, now + 5_000);
    assert.equal(isApprovalExpired({ deadline: now - 1 }, now), true);
    assert.equal(isApprovalExpired({ deadline: now + 10_000 }, now), false);
  });
});
