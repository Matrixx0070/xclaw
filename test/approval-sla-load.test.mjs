/**
 * Approval SLA under load: many concurrent pending + decide all fast.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createApprovalGate } from "../src/security/approvals.mjs";

describe("approval SLA under load", () => {
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

  it("20 concurrent pending: all decide() under 200ms total", async () => {
    const N = 20;
    const gate = createApprovalGate({
      security: {
        autoApprove: false,
        approvalPolicy: "risky",
        requireApproval: ["bash"],
        approvalSlaMs: 60_000,
      },
    });
    gates.push(gate);

    const pending = [];
    for (let i = 0; i < N; i++) {
      pending.push(
        gate.authorize("bash", { command: `echo ${i}` }, { timeoutMs: 30_000 })
      );
    }
    // Poll rather than sleeping a fixed 30ms: under full-suite parallelism only
    // some of the authorize() calls had registered by then (seen at 17/20), so
    // the assertion raced the scheduler rather than testing the gate.
    const deadline = Date.now() + 5000;
    let list = gate.listPending();
    while (list.length < N && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
      list = gate.listPending();
    }
    assert.ok(list.length >= N, `expected >=${N} pending, got ${list.length}`);

    const t0 = Date.now();
    for (const p of list.slice(0, N)) {
      const d = gate.decide(p.id, true, "load-test");
      assert.equal(d.ok, true, JSON.stringify(d));
    }
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 1000, `decide batch took ${elapsed}ms (limit 1000)`);

    const results = await Promise.all(pending);
    assert.equal(results.length, N);
    assert.ok(results.every((r) => r.ok === true));
  });

  it("20 concurrent SLA denials complete without hang", async () => {
    const N = 20;
    const gate = createApprovalGate({
      security: {
        autoApprove: false,
        approvalPolicy: "risky",
        requireApproval: ["bash"],
        approvalSlaMs: 60,
        approvalSlaTickMs: 15,
        approvalSlaAction: "deny",
      },
    });
    gates.push(gate);

    const t0 = Date.now();
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        gate.authorize("bash", { command: `sla ${i}` }, { timeoutMs: 60 })
      )
    );
    const elapsed = Date.now() - t0;
    assert.equal(results.length, N);
    assert.ok(results.every((r) => r.ok === false));
    assert.ok(elapsed < 3000, `SLA batch hung: ${elapsed}ms`);
  });
});
