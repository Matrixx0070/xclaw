/**
 * RULE(n)+RULE(k) sweep #67 — the per-job cost cap predicate
 * (`checkJobCostBudget`, default $1/job — the runaway-job money brake).
 * The loop-stages arm is tested with a STUBBED checker, so fail-opening
 * the real comparator left the FULL suite green (3870/0): a runaway job
 * would never block on its own spend. Pins the predicate directly —
 * boundary (`>` admits exactly-at-cap), estimate projection, and the
 * config chain — plus a wire pin that the loop hands the REAL predicate
 * to the stub-tested arm.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import { checkJobCostBudget } from "../src/tokens/cost-governor.mjs";

describe("per-job cost cap (sweep #67)", () => {
  it("over the default $1 cap blocks with scope job; exactly at the cap admits (> boundary)", () => {
    const over = checkJobCostBudget({}, 1.01);
    assert.equal(over.ok, false);
    assert.equal(over.code, "BUDGET_EXCEEDED");
    assert.equal(over.scope, "job");
    assert.equal(over.limitUsd, 1);
    assert.match(over.message, /Per-job cap \$1 exceeded/);
    assert.equal(checkJobCostBudget({}, 1.0).ok, true, "exactly at the cap is admitted");
    assert.equal(checkJobCostBudget({}, 0.25).ok, true);
    assert.equal(checkJobCostBudget({}).ok, true, "no spend defaults to 0");
  });

  it("the estimate projects forward: spent + estimate over the cap blocks BEFORE spending", () => {
    assert.equal(checkJobCostBudget({}, 0.5, 0.6).ok, false, "0.5 spent + 0.6 estimate = 1.1 projected");
    assert.equal(checkJobCostBudget({}, 0.5, 0.4).ok, true, "0.9 projected stays under");
  });

  it("config chain: cost.perJobUsd wins, agent.maxUsdPerJob is the fallback, default 1", () => {
    assert.equal(checkJobCostBudget({ cost: { perJobUsd: 5 } }, 4.9).ok, true);
    assert.equal(checkJobCostBudget({ cost: { perJobUsd: 5 } }, 5.1).ok, false);
    assert.equal(checkJobCostBudget({ agent: { maxUsdPerJob: 3 } }, 2.9).ok, true);
    assert.equal(checkJobCostBudget({ agent: { maxUsdPerJob: 3 } }, 3.1).ok, false);
    const both = checkJobCostBudget({ cost: { perJobUsd: 5 }, agent: { maxUsdPerJob: 3 } }, 4);
    assert.equal(both.ok, true, "explicit cost.perJobUsd beats the agent fallback");
    assert.equal(checkJobCostBudget({}, 2).limitUsd, 1, "default cap is $1");
  });

  it("the loop wires the REAL predicate into the stub-tested preflight arm", () => {
    const loop = fs.readFileSync(new URL("../src/agent/loop.mjs", import.meta.url), "utf8");
    assert.match(loop, /checkJobBudget: \(spent\) => checkJobCostBudget\(cfg, spent\)/);
  });
});
