import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildGoalPlan,
  formatGoalPlanForPrompt,
  listFailedTools,
  buildAlternateStrategyNudge,
  buildGoalReceipt,
} from "../src/agent/goal-loop.mjs";

describe("A2 goal loop", () => {
  it("buildGoalPlan always has phases", () => {
    const p = buildGoalPlan("add tests for auth");
    assert.ok(p.objective.includes("add tests"));
    assert.ok(p.steps.length >= 4);
    assert.ok(p.verifyHints.some((h) => /test/i.test(h)));
  });

  it("formatGoalPlanForPrompt includes objective", () => {
    const s = formatGoalPlanForPrompt(buildGoalPlan("ship feature X"));
    assert.match(s, /Goal loop/);
    assert.match(s, /ship feature X/);
    assert.match(s, /Verify:/);
  });

  it("alternate strategy only when failures exist", () => {
    assert.equal(buildAlternateStrategyNudge([]), null);
    assert.equal(buildAlternateStrategyNudge([{ name: "bash", status: "ok" }]), null);
    const n = buildAlternateStrategyNudge([
      { name: "web_search", status: "fail", outcome: { summary: "timeout" } },
    ]);
    assert.match(n, /web_search/);
    assert.match(n, /Switch strategy/);
  });

  it("listFailedTools", () => {
    const f = listFailedTools([
      { name: "a", status: "ok" },
      { name: "b", status: "error" },
    ]);
    assert.equal(f.length, 1);
    assert.equal(f[0].name, "b");
  });

  it("buildGoalReceipt summarizes run", () => {
    const plan = buildGoalPlan("write hello.txt");
    const r = buildGoalReceipt({
      goal: "write hello.txt",
      plan,
      toolTrace: [
        { name: "xclaw_file_write", status: "ok" },
        { name: "xclaw_file_read", status: "ok" },
      ],
      finalText: "Wrote and verified hello.txt",
      stopReason: "natural",
      turns: 2,
      alternateStrategyUsed: false,
      handoffRetryUsed: false,
    });
    assert.equal(r.version, 1);
    assert.equal(r.toolCallCount, 2);
    assert.ok(r.toolsUsed.includes("xclaw_file_write"));
    assert.equal(r.stopReason, "natural");
  });
});
