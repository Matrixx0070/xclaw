import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRunBudget } from "../src/agent/run-budget.mjs";

describe("per-run budget caps", () => {
  it("disabled when no caps configured", () => {
    const b = createRunBudget({});
    assert.equal(b.enabled, false);
    assert.equal(b.check({ toolCalls: 9999, totalTokens: 1e9 }), null);
  });

  it("ignores zero/negative/garbage caps", () => {
    const b = createRunBudget({
      agent: { budget: { maxToolCalls: 0, maxTokens: -5, maxWallMs: "nope" } },
    });
    assert.equal(b.enabled, false);
  });

  it("stops on tool-call cap", () => {
    const b = createRunBudget({ agent: { budget: { maxToolCalls: 10 } } });
    assert.equal(b.check({ toolCalls: 9 }), null);
    const hit = b.check({ toolCalls: 10 });
    assert.equal(hit.reason, "tool_calls");
    assert.equal(hit.limit, 10);
  });

  it("stops on token cap", () => {
    const b = createRunBudget({ agent: { budget: { maxTokens: 50_000 } } });
    assert.equal(b.check({ totalTokens: 49_999 }), null);
    assert.equal(b.check({ totalTokens: 50_000 }).reason, "tokens");
  });

  it("stops on wall-clock cap", () => {
    const b = createRunBudget(
      { agent: { budget: { maxWallMs: 60_000 } } },
      { startedAt: 1_000_000 }
    );
    assert.equal(b.check({ now: 1_059_999 }), null);
    const hit = b.check({ now: 1_060_000 });
    assert.equal(hit.reason, "wall_clock_ms");
    assert.equal(hit.used, 60_000);
  });

  it("wall clock wins over other caps when both exceeded", () => {
    const b = createRunBudget(
      { agent: { budget: { maxWallMs: 1, maxToolCalls: 1 } } },
      { startedAt: 0 }
    );
    assert.equal(b.check({ toolCalls: 5, now: 5 }).reason, "wall_clock_ms");
  });

  // Tripwire: refactors have silently dropped loop wiring before (3.78.0 MCP
  // regression) — assert the budget gate is still wired into the turn loop.
  it("loop.mjs keeps the budget gate wired", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../src/agent/loop.mjs", import.meta.url),
      "utf8"
    );
    assert.ok(src.includes("createRunBudget(cfg)"), "budget created from cfg");
    assert.ok(src.includes("runBudget.check("), "budget checked in loop");
    assert.ok(
      src.includes('type: "budget", phase: "exceeded"'),
      "budget event emitted"
    );
  });
});
