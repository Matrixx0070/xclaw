import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { preflightJobBudgets, budgetBlockedJob } from "../src/jobs/job-dual-preflight.mjs";
import { checkLoopCostBudget } from "../src/tokens/loop-cost-check.mjs";

describe("dual preflight job+loop", () => {
  it("preflightJobBudgets passes when seats off", async () => {
    const r = await preflightJobBudgets(
      {
        paths: { configDir: "/tmp/xclaw-jdp-missing" },
        cost: { dailyHardUsd: 50 },
        seats: { enabled: false },
      },
      { ensureFresh: async () => ({ ok: true, source: "store" }), apps: ["xai"] }
    );
    assert.equal(r.ok, true);
    assert.ok(r.cost);
  });

  it("budgetBlockedJob marks cost vs seat", () => {
    const j = budgetBlockedJob({
      id: "j",
      goal: "g",
      workspace: "/tmp",
      r: { ok: false, blockedBy: "seat", message: "seat cap", code: "SEAT_BUDGET_EXCEEDED" },
    });
    assert.equal(j.seatBlocked, true);
    assert.equal(j.costBlocked, false);
    assert.equal(j.code, "SEAT_BUDGET_EXCEEDED");
  });

  it("checkLoopCostBudget uses dualBudgetPreflight", async () => {
    const r = await checkLoopCostBudget(
      {
        paths: { configDir: "/tmp/xclaw-jdp2-missing" },
        cost: { dailyHardUsd: 50 },
        seats: { enabled: false },
      },
      { ensureFresh: async () => ({ ok: true, source: "store" }), apps: ["xai"] }
    );
    assert.ok("blockedBy" in r || r.ok === true);
    assert.ok(r.auth || r.cost);
  });
});
