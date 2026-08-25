/**
 * Approval-path latency: SLA deny fires on time; decide() is fast.
 *
 * Flake history (fixed 2026-08-25): this file failed intermittently in full
 * suite runs, never in isolation. Reproduced by running it against a loaded box
 * (12 spinners on 4 cores), where it failed 3 of 5 rounds — always on
 * `list.length >= 1`, never on a latency bound. The cause was a fixed 15ms
 * sleep standing in for synchronisation: the gate registers the pending record
 * asynchronously, and under contention 15ms of wall clock can pass without that
 * continuation running at all. waitForPending polls instead.
 *
 * The elapsed-time assertions below survived every loaded round and are left
 * exactly as they were — they are the point of the file, and loosening bounds
 * that never fired would trade real coverage for nothing.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createApprovalGate } from "../src/security/approvals.mjs";

/** Wait for the gate to register a pending record. The deadline is generous
 *  because it is not what this file measures; decide() is timed separately. */
async function waitForPending(gate, ms = 5000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const list = gate.listPending();
    if (list.length >= 1) return list;
    if (Date.now() >= deadline) throw new Error(`no pending approval within ${ms}ms`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

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
    const list = await waitForPending(gate);
    assert.ok(list.length >= 1, "the gate must register the request as pending");
    const t0 = Date.now();
    const d = gate.decide(list[0].id, false, "latency-test");
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 100, `decide() took ${elapsed}ms`);
    assert.equal(d.ok, true);
    const auth = await pendingP;
    assert.equal(auth.ok, false);
  });
});
