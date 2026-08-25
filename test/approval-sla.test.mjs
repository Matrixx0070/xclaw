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
    // authorize registers the pending entry only after its own awaits, so a
    // fixed sleep is a race: under a loaded event loop (the full suite, or CI)
    // 20ms of wall clock can pass before registration and listPending() comes
    // back empty. Poll to the registration instead — still well inside the 5s
    // authorize timeout, so the entry is genuinely pending when we read it.
    let list = [];
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      list = gate.listPending();
      if (list.length >= 1) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.ok(list.length >= 1, "authorize never registered a pending approval");
    assert.ok(typeof list[0].ageMs === "number");
    assert.ok(list[0].remainingMs != null);
    const st = gate.slaStats();
    assert.ok(st.pending >= 1);
    // deny to clean up
    gate.decide(list[0].id, false, "test");
    await p.catch(() => {});
  });
});
