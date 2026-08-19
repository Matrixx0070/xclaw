import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCostGovernor } from "../src/agent/cost-governor.mjs";

describe("budget stop integration", () => {
  it("governor blocks cleanly at tool_calls ceiling", () => {
    const g = createCostGovernor({ agent: { budget: { maxToolCalls: 3 } } }, {});
    assert.equal(g.check({ toolCalls: 2 }).blocked, false);
    const hit = g.check({ toolCalls: 3 });
    assert.equal(hit.blocked, true);
    assert.equal(hit.reason, "tool_calls");
  });
});
