import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateReleaseGateStrict } from "../src/eval/release-gate-strict.mjs";

describe("release-gate:strict extras", () => {
  it("fails high flake rate", () => {
    const r = evaluateReleaseGateStrict({
      flake: { totalCases: 100, flakeCount: 10 },
      coldStart: { totalMs: 200, healthStatus: 200 },
    });
    assert.equal(r.ok, false);
    assert.ok(r.failed.includes("flake_budget"));
  });

  it("fails slow cold-start when report present", () => {
    const r = evaluateReleaseGateStrict({
      flake: { totalCases: 100, flakeCount: 0 },
      coldStart: { totalMs: 9000, healthStatus: 200 },
    });
    assert.equal(r.ok, false);
    assert.ok(r.failed.includes("cold_start"));
  });

  it("passes under budgets", () => {
    const r = evaluateReleaseGateStrict({
      flake: { totalCases: 100, flakeCount: 1 },
      coldStart: { totalMs: 180, healthStatus: 200 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.failed.length, 0);
  });
});
