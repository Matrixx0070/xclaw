/**
 * Retry-After respect + decorrelated jitter budget.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseRetryAfterMs,
  getRetryAfterMs,
  computeJitterDelay,
  resolveJitterStrategy,
} from "../src/utils/backoff.mjs";

describe("Retry-After", () => {
  it("parses integer seconds", () => {
    assert.equal(parseRetryAfterMs("2"), 2000);
    assert.equal(parseRetryAfterMs(5), 5000);
  });

  it("parses HTTP-date", () => {
    const now = Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");
    const later = "Wed, 21 Oct 2015 07:28:10 GMT";
    assert.equal(parseRetryAfterMs(later, now), 10_000);
  });

  it("reads err.retryAfter", () => {
    assert.equal(getRetryAfterMs({ retryAfter: "3" }), 3000);
  });
});

describe("decorrelated jitter", () => {
  it("resolves alias names", () => {
    assert.equal(resolveJitterStrategy("decorrelated_jitter"), "decorrelated");
  });

  it("stays in [base, min(max, prev*3)]", () => {
    const samples = [];
    for (let i = 0; i < 40; i++) {
      samples.push(
        computeJitterDelay("decorrelated", 2, {
          baseMs: 100,
          maxDelayMs: 800,
          prevDelayMs: 200,
          random: () => i / 40,
        })
      );
    }
    assert.ok(samples.every((d) => d >= 100 && d <= 600));
    assert.ok(Math.min(...samples) < Math.max(...samples));
  });

  it("none strategy is deterministic exponential", () => {
    const a = computeJitterDelay("none", 3, { baseMs: 100, maxDelayMs: 10_000 });
    const b = computeJitterDelay("none", 3, { baseMs: 100, maxDelayMs: 10_000 });
    assert.equal(a, b);
    assert.equal(a, 800);
  });
});
