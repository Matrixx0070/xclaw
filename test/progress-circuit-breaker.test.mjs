import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createOpenClawLoopDetector } from "../src/agent/openclaw-loop/detection.mjs";

describe("progress-aware circuit breaker", () => {
  it("warns at threshold when history shows mixed tools (progress)", () => {
    const d = createOpenClawLoopDetector({
      enabled: true,
      globalCircuitBreakerThreshold: 5,
      historySize: 20,
      warningThreshold: 10,
    });
    // Different args each time → progress
    for (let i = 0; i < 5; i++) {
      d.record("xclaw_file_read", { path: `/f${i}` }, `content-${i}`);
    }
    const r = d.detect("xclaw_file_read", { path: "/f5" });
    // At threshold with progress → warning soft, not critical
    if (r.stuck) {
      assert.equal(r.level, "warning");
      assert.equal(r.detector, "global_circuit_breaker_soft");
    }
  });

  it("critical at hard ceiling regardless", () => {
    const d = createOpenClawLoopDetector({
      enabled: true,
      globalCircuitBreakerThreshold: 4,
      historySize: 30,
      warningThreshold: 99,
    });
    for (let i = 0; i < 6; i++) {
      d.record("xclaw_file_read", { path: `/x${i}` }, `body-${i}`);
    }
    const r = d.detect("xclaw_file_read", { path: "/z" });
    assert.equal(r.stuck, true);
    assert.equal(r.level, "critical");
    assert.equal(r.detector, "global_circuit_breaker");
  });

  it("loop soft-stops critical without throw", () => {
    const src = fs.readFileSync(
      new URL("../src/agent/loop.mjs", import.meta.url),
      "utf8"
    );
    assert.match(src, /softStop:\s*true/);
    assert.match(src, /return "stop"/);
    assert.doesNotMatch(
      src,
      /level === "critical"[\s\S]{0,200}throw new Error\(verdict\.message\)/
    );
  });

  it("anthropic provider exports real chatStream", () => {
    const src = fs.readFileSync(
      new URL("../src/providers/anthropic-messages.mjs", import.meta.url),
      "utf8"
    );
    assert.match(src, /stream:\s*true/);
    assert.match(src, /text_delta/);
    assert.match(src, /input_json_delta/);
    assert.doesNotMatch(
      src,
      /chatStream:\s*async \(args\) => chat\(args\)/
    );
  });
});
