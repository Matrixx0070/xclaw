import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveLiveGoals } from "../src/eval/horizon-live-goals.mjs";
import { DEFAULT_LIVE_IDS } from "../src/eval/horizon-live-report.mjs";
import { runHorizonLive } from "../src/eval/horizon-live.mjs";

describe("horizon live goals", () => {
  it("resolves G10-G14 prompts", async () => {
    const r = await resolveLiveGoals({});
    assert.deepEqual(r.ids, DEFAULT_LIVE_IDS);
    assert.equal(r.goals.length, 5);
    for (const g of r.goals) {
      assert.ok(g.prompt.length > 10, g.id);
    }
  });

  it("injected runAgent receives non-empty goal", async () => {
    process.env.XAI_API_KEY = process.env.XAI_API_KEY || "test-key-not-real";
    const seen = [];
    const r = await runHorizonLive({
      requireLive: true,
      maxUsd: 2,
      maxTurns: 4,
      ids: ["a4-G10-plan-write-verify-fix"],
      runAgent: async (req) => {
        seen.push(req.goal || req.userMessage || "");
        return { ok: true, text: "ok" };
      },
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(seen.length, 1);
    assert.ok(seen[0].includes("plan.txt"));
    assert.notEqual(r.live?.error, "empty_goal");
  });
});
