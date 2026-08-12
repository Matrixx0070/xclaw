import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createApprovalGate } from "../src/security/approvals.mjs";

describe("approval SLA", () => {
  it("listPending includes age fields", async () => {
    const gate = createApprovalGate({
      security: {
        autoApprove: false,
        approvalPolicy: "risky",
        requireApproval: ["bash"],
        approvalSlaMs: 60_000,
      },
    });
    // start authorize without awaiting fully
    const p = gate.authorize("bash", { command: "true" }, { timeoutMs: 5_000 });
    await new Promise((r) => setTimeout(r, 20));
    const list = gate.listPending();
    assert.ok(list.length >= 1);
    assert.ok(typeof list[0].ageMs === "number");
    assert.ok(list[0].remainingMs != null);
    const st = gate.slaStats();
    assert.ok(st.pending >= 1);
    // deny to clean up
    gate.decide(list[0].id, false, "test");
    await p.catch(() => {});
  });
});
