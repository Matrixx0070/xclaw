/**
 * Argument-churn storm: same tool, rotating args, identical outcomes.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createLoopGuard } from "../src/agent/loop-guards.mjs";

describe("loop guard argument churn", () => {
  it("flags rotating-args same-outcome storm", () => {
    const g = createLoopGuard({
      warningThreshold: 3,
      criticalThreshold: 8,
      globalCircuitBreakerThreshold: 80,
      detectors: {
        genericRepeat: true,
        argumentChurn: true,
        pingPong: true,
        knownPollNoProgress: true,
      },
    });
    const a = { command: "ls /tmp" };
    const b = { command: "ls /var" };
    const outcome = "ok-same";
    for (let i = 0; i < 3; i++) g.record("xclaw_bash", a, outcome);
    for (let i = 0; i < 3; i++) g.record("xclaw_bash", b, outcome);
    const r = g.detect("xclaw_bash", a);
    assert.equal(r.stuck, true, JSON.stringify(r));
    assert.ok(
      r.kind === "argument_churn" ||
        r.detector === "argument_churn" ||
        /churn|repeat/i.test(String(r.message || r.kind || "")),
      JSON.stringify(r)
    );
  });

  it("does not flag first distinct call", () => {
    const g = createLoopGuard({
      warningThreshold: 3,
      criticalThreshold: 10,
    });
    const r = g.detect("xclaw_bash", { command: "echo once" });
    assert.equal(r.stuck, false);
  });
});
