import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyFailure,
  recoveryStrategyFor,
} from "../src/jobs/checkpoint.mjs";

describe("checkpoint recovery strategies", () => {
  it("classifies transport", () => {
    assert.equal(classifyFailure("ECONNREFUSED computer not available"), "transport");
  });
  it("classifies budget", () => {
    assert.equal(classifyFailure("BUDGET_EXCEEDED hard cap"), "budget");
  });
  it("classifies security", () => {
    assert.equal(classifyFailure("denied by approval"), "security");
  });
  it("classifies grounding", () => {
    assert.equal(classifyFailure("grounding hard fail"), "grounding");
  });
  it("classifies interrupted mid-run", () => {
    assert.equal(
      classifyFailure("", { midRun: true, status: "running", turns: 6 }),
      "interrupted"
    );
  });
  it("grounding strategy includes warnings", () => {
    const plan = recoveryStrategyFor("grounding", {
      turns: 4,
      maxTurns: 12,
      groundingWarnings: ["orphan claim"],
    });
    assert.equal(plan.strategy, "grounding");
    assert.match(plan.goalSuffix, /orphan claim/);
    assert.equal(plan.claimsRequireEvidence, true);
  });
  it("budget strategy boosts turns slightly", () => {
    const plan = recoveryStrategyFor("budget", { turns: 10, maxTurns: 12 });
    assert.ok(plan.maxTurns >= 4);
  });
  it("interrupted strategy cites turn", () => {
    const plan = recoveryStrategyFor("interrupted", {
      turns: 6,
      checkpointTurn: 6,
      maxTurns: 24,
    });
    assert.match(plan.goalSuffix, /turn 6/);
  });
});
