/**
 * Eval flake budget thresholds.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateFlakeBudget,
  countFlakesFromAttempts,
  resolveFlakeBudget,
  DEFAULT_FLAKE_BUDGET,
} from "../src/eval/flake-budget.mjs";

describe("flake budget", () => {
  it("defaults", () => {
    const b = resolveFlakeBudget({});
    assert.equal(b.maxRate, DEFAULT_FLAKE_BUDGET.maxRate);
  });

  it("fails when rate high with enough cases", () => {
    const v = evaluateFlakeBudget({ totalCases: 100, flakeCount: 5 }, {});
    assert.equal(v.ok, false);
    assert.ok(v.reason.includes("flake rate"));
  });

  it("passes under 2%", () => {
    const v = evaluateFlakeBudget({ totalCases: 100, flakeCount: 1 }, {});
    assert.equal(v.ok, true);
  });

  it("absolute cap for small n", () => {
    const v = evaluateFlakeBudget({ totalCases: 10, flakeCount: 3 }, {});
    assert.equal(v.ok, false);
  });

  it("countFlakesFromAttempts detects intermittent cases", () => {
    const c = countFlakesFromAttempts([
      { id: "a", pass: true },
      { id: "a", pass: false },
      { id: "b", pass: true },
      { id: "b", pass: true },
    ]);
    assert.equal(c.totalCases, 2);
    assert.equal(c.flakeCount, 1);
  });
});
