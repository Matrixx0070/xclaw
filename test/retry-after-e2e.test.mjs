/**
 * 429 Retry-After end-to-end: mock provider error → withBackoff honors header.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  withBackoff,
  getRetryAfterMs,
  parseRetryAfterMs,
  isTransientError,
} from "../src/utils/backoff.mjs";

function make429(retryAfter) {
  const err = new Error("rate limited");
  err.status = 429;
  err.code = "RATE_LIMIT";
  err.retryAfter = retryAfter;
  err.headers = { "retry-after": String(retryAfter) };
  return err;
}

describe("429 Retry-After e2e", () => {
  it("isTransientError treats 429 as retryable", () => {
    assert.equal(isTransientError(make429(1)), true);
  });

  it("getRetryAfterMs reads seconds from err", () => {
    assert.equal(getRetryAfterMs(make429(2)), 2000);
    assert.equal(parseRetryAfterMs("1"), 1000);
  });

  it("withBackoff waits ~Retry-After before success", async () => {
    let calls = 0;
    const delays = [];
    const t0 = Date.now();
    const result = await withBackoff(
      async () => {
        calls += 1;
        if (calls === 1) throw make429(1);
        return { ok: true, calls };
      },
      {
        retries: 3,
        baseMs: 50,
        maxDelayMs: 10_000,
        strategy: "none",
        respectRetryAfter: true,
        retryAfterJitterRatio: 0,
        onRetry: (info) => delays.push(info),
      }
    );
    const elapsed = Date.now() - t0;
    assert.equal(result.ok, true);
    assert.equal(calls, 2);
    assert.equal(delays.length, 1);
    assert.equal(delays[0].usedRetryAfter, true);
    assert.equal(delays[0].retryAfterMs, 1000);
    assert.ok(elapsed >= 900, `elapsed ${elapsed}ms expected >=900`);
    assert.ok(elapsed < 5000, `elapsed ${elapsed}ms too long`);
  });

  it("without Retry-After uses exponential base (fast)", async () => {
    let calls = 0;
    const t0 = Date.now();
    await withBackoff(
      async () => {
        calls += 1;
        if (calls === 1) {
          const err = new Error("503");
          err.status = 503;
          throw err;
        }
        return true;
      },
      {
        retries: 2,
        baseMs: 20,
        maxDelayMs: 100,
        strategy: "none",
        respectRetryAfter: true,
        retryAfterJitterRatio: 0,
      }
    );
    const elapsed = Date.now() - t0;
    assert.equal(calls, 2);
    assert.ok(elapsed < 500, `expected fast exp backoff, got ${elapsed}ms`);
  });
});
