/**
 * Phase 7.1 — loop guard / argument-churn tests
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createLoopGuard } from "../src/agent/loop-guards.mjs";
import { createToolLoopDetector } from "../src/agent/tool-loop-detection.mjs";

describe("createLoopGuard (OpenClaw-style)", () => {
  it("allows first calls", () => {
    const g = createLoopGuard({
      warningThreshold: 3,
      criticalThreshold: 5,
      globalCircuitBreakerThreshold: 50,
    });
    const r = g.detect("xclaw_bash", { command: "ls" });
    assert.equal(r.stuck, false);
  });

  it("warns on repeated identical args after threshold", () => {
    const g = createLoopGuard({
      warningThreshold: 3,
      criticalThreshold: 10,
      globalCircuitBreakerThreshold: 50,
      detectors: { genericRepeat: true, argumentChurn: true, pingPong: true, knownPollNoProgress: true },
    });
    const args = { command: "true" };
    for (let i = 0; i < 3; i++) {
      g.record("xclaw_bash", args, "ok");
    }
    const r = g.detect("xclaw_bash", args);
    assert.equal(r.stuck, true);
    assert.ok(["warning", "critical"].includes(r.level));
  });

  it("snapshot and reset", () => {
    const g = createLoopGuard({ warningThreshold: 2, criticalThreshold: 5 });
    g.record("t", { a: 1 }, "x");
    assert.ok(g.snapshot().historyLen >= 1);
    g.reset();
    assert.equal(g.snapshot().historyLen, 0);
  });
});

describe("createToolLoopDetector (simple)", () => {
  it("exact_repeat critical", () => {
    const d = createToolLoopDetector({ maxExactRepeats: 3, maxArgumentChurn: 20, maxNoProgress: 20, maxSameTool: 50 });
    const args = { path: "/tmp" };
    d.detect("read", args, "data");
    d.detect("read", args, "data");
    const r = d.detect("read", args, "data");
    assert.equal(r.stuck, true);
    assert.equal(r.kind, "exact_repeat");
  });

  it("same_tool_cap", () => {
    const d = createToolLoopDetector({ maxExactRepeats: 100, maxSameTool: 3, maxArgumentChurn: 100, maxNoProgress: 100 });
    d.detect("bash", { c: "1" }, "a");
    d.detect("bash", { c: "2" }, "b");
    const r = d.detect("bash", { c: "3" }, "c");
    assert.equal(r.stuck, true);
    assert.equal(r.kind, "same_tool_cap");
  });
});
