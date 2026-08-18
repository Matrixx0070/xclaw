/**
 * Approval-path latency: SLA deny fires on time; decide() is fast.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createApprovalGate } from "../src/security/approvals.mjs";

describe("approval path latency", () => {
  const gates = [];
  after(() => {
    for (const g of gates) {
      try {
        g.destroy?.();
      } catch {
        /* */
      }
    }
  });

  it("SLA deny resolves within timeout + tick slack", async () => {
    const gate = createApprovalGate({
      security: {
        autoApprove: false,
        approvalPolicy: "risky",
        requireApproval: ["bash"],
        approvalSlaMs: 80,
        approvalSlaTickMs: 20,
        approvalSlaAction: "deny",
      },
    });
    gates.push(gate);
    const t0 = Date.now();
    const result = await gate.authorize("bash", { command: "true" }, { timeoutMs: 80 });
    const elapsed = Date.now() - t0;
    assert.equal(result.ok, false);
    assert.ok(
      result.reason === "sla_timeout" || /sla|timeout/i.test(String(result.reason || result.message || "")),
      JSON.stringify(result)
    );
    assert.ok(elapsed < 1500, `SLA deny too slow: ${elapsed}ms`);
    assert.ok(elapsed >= 50, `SLA deny too early: ${elapsed}ms`);
  });

  it("human decide() is sub-100ms after pending", async () => {
    const gate = createApprovalGate({
      security: {
        autoApprove: false,
        approvalPolicy: "risky",
        requireApproval: ["bash"],
        approvalSlaMs: 30_000,
      },
    });
    gates.push(gate);
    const pendingP = gate.authorize("bash", { command: "true" }, { timeoutMs: 10_000 });
    await new Promise((r) => setTimeout(r, 15));
    const list = gate.listPending();
    assert.ok(list.length >= 1);
    const t0 = Date.now();
    const d = gate.decide(list[0].id, false, "latency-test");
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 100, `decide() took ${elapsed}ms`);
    assert.equal(d.ok, true);
    const auth = await pendingP;
    assert.equal(auth.ok, false);
  });
});
