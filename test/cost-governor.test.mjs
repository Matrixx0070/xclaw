import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCostGovernor } from "../src/agent/cost-governor.mjs";

describe("cost governor", () => {
  it("blocks on max tool calls", () => {
    const job = {};
    const g = createCostGovernor({ agent: { budget: { maxToolCalls: 2 } } }, job);
    assert.equal(g.check({ toolCalls: 1 }).blocked, false);
    const hit = g.check({ toolCalls: 2 });
    assert.equal(hit.blocked, true);
    assert.equal(hit.reason, "tool_calls");
  });
  it("blocks on maxUsd", () => {
    const g = createCostGovernor({ agent: { budget: { maxUsd: 1 } } }, {});
    g.record({ usd: 1.5 });
    const hit = g.check();
    assert.equal(hit.blocked, true);
    assert.equal(hit.reason, "max_usd");
  });
});
