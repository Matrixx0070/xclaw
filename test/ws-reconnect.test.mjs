import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  wsReconnectDelayMs,
  createWsReconnectScheduler,
} from "../src/utils/ws-reconnect.mjs";
import { fullJitterBackoffMs } from "../src/utils/backoff.mjs";

describe("ws reconnect backoff", () => {
  it("full jitter stays in [0, cap]", () => {
    for (let a = 0; a < 8; a++) {
      for (let i = 0; i < 50; i++) {
        const d = wsReconnectDelayMs(a, {
          strategy: "full",
          baseMs: 1000,
          maxDelayMs: 30000,
        });
        assert.ok(d >= 0 && d <= 30000, String(d));
      }
    }
  });

  it("none strategy is pure exponential", () => {
    assert.equal(
      wsReconnectDelayMs(0, { strategy: "none", baseMs: 1000, maxDelayMs: 30000 }),
      1000
    );
    assert.equal(
      wsReconnectDelayMs(3, { strategy: "none", baseMs: 1000, maxDelayMs: 30000 }),
      8000
    );
  });

  it("scheduler resets attempt on reset()", () => {
    const s = createWsReconnectScheduler({
      strategy: "none",
      baseMs: 500,
      maxDelayMs: 10000,
    });
    assert.equal(s.nextDelay(), 500);
    assert.equal(s.nextDelay(), 1000);
    assert.equal(s.attempt, 2);
    s.reset();
    assert.equal(s.attempt, 0);
    assert.equal(s.nextDelay(), 500);
  });

  it("matches fullJitterBackoffMs shape", () => {
    const fixed = () => 0.5;
    const a = fullJitterBackoffMs(2, { baseMs: 1000, maxDelayMs: 30000, random: fixed });
    const b = wsReconnectDelayMs(2, {
      strategy: "full",
      baseMs: 1000,
      maxDelayMs: 30000,
      random: fixed,
    });
    assert.equal(a, b);
  });
});

describe("decorrelated backoff strategy", () => {
  it("stays within [base, min(max, 3*prev)]", async () => {
    const { decorrelatedBackoffMs } = await import("../src/utils/backoff.mjs");
    let prev = 1000;
    for (let i = 0; i < 100; i++) {
      const d = decorrelatedBackoffMs(i, {
        baseMs: 1000,
        maxDelayMs: 30000,
        prevDelayMs: prev,
      });
      assert.ok(d >= 1000, "floor " + d);
      assert.ok(d <= 30000, "cap " + d);
      assert.ok(d <= Math.max(1000, Math.min(30000, prev * 3)), "vs 3*prev");
      prev = d || 1000;
    }
  });

  it("sequence climbs then can drop (not pure exp)", async () => {
    const { createWsReconnectScheduler } = await import("../src/utils/ws-reconnect.mjs");
    const s = createWsReconnectScheduler({
      strategy: "decorrelated",
      baseMs: 200,
      maxDelayMs: 10000,
    });
    const delays = [];
    for (let i = 0; i < 15; i++) delays.push(s.nextDelay());
    // all finite and in range
    for (const d of delays) {
      assert.ok(d >= 200 && d <= 10000);
    }
    // variance: not all equal
    const uniq = new Set(delays.map((d) => Math.round(d / 50)));
    assert.ok(uniq.size >= 2, "should vary");
  });

  it("deterministic with fixed random", async () => {
    const { decorrelatedBackoffMs } = await import("../src/utils/backoff.mjs");
    const d = decorrelatedBackoffMs(0, {
      baseMs: 100,
      maxDelayMs: 1000,
      prevDelayMs: 100,
      random: () => 0.5,
    });
    // U(100, min(1000, 300)) = U(100, 300) → 100 + 0.5*200 = 200
    assert.equal(d, 200);
  });
});
