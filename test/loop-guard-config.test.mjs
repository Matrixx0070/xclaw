import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createOpenClawLoopDetector } from "../src/agent/openclaw-loop/detection.mjs";
import { applyProfile, PROFILES } from "../src/config/profiles.mjs";
import { DEFAULT_CONFIG } from "../src/config/defaults.mjs";

describe("loop guard config", () => {
  it("lab profile raises global circuit breaker above 30", () => {
    const cfg = applyProfile({ ...structuredClone(DEFAULT_CONFIG), profile: "lab" });
    assert.ok(cfg.agent.loopGuard.globalCircuitBreakerThreshold >= 60);
    assert.ok(cfg.agent.loopGuard.historySize >= 60);
  });

  it("prod profile is tighter than lab", () => {
    const lab = applyProfile({ ...structuredClone(DEFAULT_CONFIG), profile: "lab" });
    const prod = applyProfile({ ...structuredClone(DEFAULT_CONFIG), profile: "prod" });
    assert.ok(
      prod.agent.loopGuard.globalCircuitBreakerThreshold <
        lab.agent.loopGuard.globalCircuitBreakerThreshold
    );
  });

  it("circuitBreaker alias maps to global threshold", () => {
    const d = createOpenClawLoopDetector({ circuitBreaker: 55, historySize: 10 });
    // trips only after 55 records — counted across ALL calls, even though
    // the sliding window (historySize 10) is smaller than the threshold
    for (let i = 0; i < 54; i++) {
      d.record("xclaw_bash", { command: `echo ${i}` }, "ok");
    }
    const early = d.detect("xclaw_bash", { command: "echo next" });
    assert.equal(early.stuck, false);
    d.record("xclaw_bash", { command: "echo 54" }, "ok");
    const late = d.detect("xclaw_bash", { command: "echo boom" });
    assert.equal(late.stuck, true);
    // progress-aware: distinct commands → soft warning at threshold
    assert.ok(String(late.detector).startsWith("global_circuit_breaker"));
    assert.equal(late.count, 55);
    // absolute hard ceiling (1.5x) still critical-stops even with progress
    for (let i = 55; i < 83; i++) {
      d.record("xclaw_bash", { command: `echo ${i}` }, "ok");
    }
    const ceiling = d.detect("xclaw_bash", { command: "echo done" });
    assert.equal(ceiling.stuck, true);
    assert.equal(ceiling.level, "critical");
    assert.equal(ceiling.detector, "global_circuit_breaker");
  });

  it("profiles expose loopGuard packs", () => {
    assert.ok(PROFILES.lab.agent.loopGuard);
    assert.ok(PROFILES.prod.agent.loopGuard);
    assert.ok(PROFILES.dev.agent.loopGuard);
  });
});
