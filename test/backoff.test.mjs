/**
 * Phase 7.1 — backoff / jitter / Retry-After tests (node:test)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  JITTER_STRATEGIES,
  resolveJitterStrategy,
  computeJitterDelay,
  parseRetryAfterMs,
  getRetryAfterMs,
  isTransientError,
  createBackoff,
  withBackoff,
  backoffOptsFromConfig,
  exponentialBackoffMs,
  exponentialSchedule,
  withExponentialBackoff,
} from "../src/utils/backoff.mjs";

describe("resolveJitterStrategy", () => {
  it("maps aliases", () => {
    assert.equal(resolveJitterStrategy("FULL"), "full");
    assert.equal(resolveJitterStrategy("full-jitter"), "full");
    assert.equal(resolveJitterStrategy("equal_jitter"), "equal");
    assert.equal(resolveJitterStrategy("exponential"), "none");
    assert.equal(resolveJitterStrategy("nope"), "full");
  });
  it("lists four strategies", () => {
    assert.deepEqual([...JITTER_STRATEGIES], ["full", "equal", "decorrelated", "none"]);
  });
});

describe("computeJitterDelay", () => {
  it("full jitter with rand=0.5", () => {
    assert.equal(
      computeJitterDelay("full", 0, { baseMs: 100, random: () => 0.5 }),
      50
    );
  });
  it("none is pure exponential", () => {
    assert.equal(computeJitterDelay("none", 0, { baseMs: 100, random: () => 0 }), 100);
    assert.equal(computeJitterDelay("none", 2, { baseMs: 100, random: () => 0 }), 400);
  });
  it("decorrelated floors at base", () => {
    const d = computeJitterDelay("decorrelated", 0, {
      baseMs: 200,
      prevDelayMs: 200,
      random: () => 0,
    });
    assert.equal(d, 200);
  });
  it("respects maxDelayMs", () => {
    const d = computeJitterDelay("none", 20, { baseMs: 200, maxDelayMs: 1000, random: () => 0 });
    assert.equal(d, 1000);
  });
});

describe("Retry-After", () => {
  it("parses delta-seconds", () => {
    assert.equal(parseRetryAfterMs("5"), 5000);
    assert.equal(parseRetryAfterMs(0), 0);
    assert.equal(parseRetryAfterMs(""), null);
  });
  it("parses HTTP-date future", () => {
    const future = new Date(Date.now() + 3000).toUTCString();
    const ms = parseRetryAfterMs(future);
    assert.ok(ms != null && ms >= 2000 && ms <= 4000);
  });
  it("past HTTP-date → 0", () => {
    const past = new Date(Date.now() - 10_000).toUTCString();
    assert.equal(parseRetryAfterMs(past), 0);
  });
  it("getRetryAfterMs from err fields", () => {
    assert.equal(getRetryAfterMs({ retryAfter: "2" }), 2000);
    assert.equal(getRetryAfterMs({ headers: { "retry-after": "1" } }), 1000);
    assert.equal(getRetryAfterMs({ retryAfterMs: 1500 }), 1500);
  });
});

describe("isTransientError", () => {
  it("status codes", () => {
    assert.equal(isTransientError({ status: 429 }), true);
    assert.equal(isTransientError({ status: 503 }), true);
    assert.equal(isTransientError({ status: 400 }), false);
  });
  it("abort not transient", () => {
    assert.equal(isTransientError({ code: "ABORT_ERR" }), false);
  });
  it("timeout message", () => {
    assert.equal(isTransientError({ message: "provider timeout" }), true);
  });
  it("Retry-After on 4xx is retryable", () => {
    assert.equal(isTransientError({ status: 403, retryAfter: "1" }), true);
  });
});

describe("withBackoff", () => {
  it("retries transient then succeeds", async () => {
    let n = 0;
    const out = await withBackoff(
      async () => {
        n++;
        if (n < 3) {
          const e = new Error("503");
          e.status = 503;
          throw e;
        }
        return "ok";
      },
      { retries: 5, baseMs: 1, maxDelayMs: 5, strategy: "none" }
    );
    assert.equal(out, "ok");
    assert.equal(n, 3);
  });
  it("uses Retry-After delay path", async () => {
    let n = 0;
    let used = false;
    await withBackoff(
      async () => {
        n++;
        if (n < 2) {
          const e = new Error("rate limit");
          e.status = 429;
          e.retryAfter = "0";
          throw e;
        }
        return true;
      },
      {
        retries: 2,
        baseMs: 1000,
        strategy: "none",
        retryAfterJitterRatio: 0,
        onRetry: (info) => {
          used = info.usedRetryAfter === true;
        },
      }
    );
    assert.equal(n, 2);
    assert.equal(used, true);
  });
  it("does not retry permanent errors", async () => {
    await assert.rejects(
      () =>
        withBackoff(
          async () => {
            const e = new Error("bad");
            e.status = 400;
            throw e;
          },
          { retries: 3, baseMs: 1, strategy: "none" }
        ),
      /bad/
    );
  });
});

describe("createBackoff + config", () => {
  it("Retry-After overrides strategy", () => {
    const b = createBackoff({
      strategy: "full",
      baseMs: 100,
      maxDelayMs: 60_000,
      random: () => 0,
      retryAfterJitterRatio: 0,
    });
    assert.equal(b.delayMs(0, { retryAfter: "7" }), 7000);
  });
  it("backoffOptsFromConfig resolves strategy", () => {
    const o = backoffOptsFromConfig({ retry: { strategy: "equal-jitter", retries: 2 } });
    assert.equal(o.strategy, "equal");
    assert.equal(o.retries, 2);
  });
});

describe("exponentialBackoffMs / fullJitterBackoffMs", () => {
  it("pure exponential doubles until cap", async () => {
    const { exponentialBackoffMs } = await import("../src/utils/backoff.mjs");
    assert.equal(exponentialBackoffMs(0, { baseMs: 100, maxDelayMs: 10_000 }), 100);
    assert.equal(exponentialBackoffMs(1, { baseMs: 100, maxDelayMs: 10_000 }), 200);
    assert.equal(exponentialBackoffMs(2, { baseMs: 100, maxDelayMs: 10_000 }), 400);
    assert.equal(exponentialBackoffMs(10, { baseMs: 100, maxDelayMs: 1000 }), 1000);
  });

  it("full jitter stays within cap", async () => {
    const { fullJitterBackoffMs } = await import("../src/utils/backoff.mjs");
    for (let a = 0; a < 12; a++) {
      const d = fullJitterBackoffMs(a, { baseMs: 50, maxDelayMs: 800 });
      assert.ok(d >= 0 && d <= 800, String(d));
    }
  });

  it("withExponentialBackoff retries then succeeds", async () => {
    const { withExponentialBackoff } = await import("../src/utils/backoff.mjs");
    let n = 0;
    const v = await withExponentialBackoff(
      async () => {
        n += 1;
        if (n < 3) {
          const e = new Error("tmp");
          e.status = 503;
          throw e;
        }
        return "ok";
      },
      { retries: 5, baseMs: 1, maxDelayMs: 5, strategy: "none" }
    );
    assert.equal(v, "ok");
    assert.ok(n >= 3);
  });
});

describe("exponential backoff explicit", () => {
  it("exponentialBackoffMs doubles", () => {
    assert.equal(exponentialBackoffMs(0, { baseMs: 100, maxDelayMs: 10_000 }), 100);
    assert.equal(exponentialBackoffMs(1, { baseMs: 100, maxDelayMs: 10_000 }), 200);
    assert.equal(exponentialBackoffMs(2, { baseMs: 100, maxDelayMs: 10_000 }), 400);
  });

  it("exponentialSchedule length", () => {
    const s = exponentialSchedule(4, { baseMs: 50, maxDelayMs: 10_000 });
    assert.deepEqual(s, [50, 100, 200, 400]);
  });

  it("isTransientError rate_limit and 529", () => {
    assert.equal(isTransientError({ status: 429 }), true);
    assert.equal(isTransientError({ status: 529 }), true);
    assert.equal(isTransientError({ type: "rate_limit_error" }), true);
    assert.equal(isTransientError({ type: "overloaded_error" }), true);
    assert.equal(isTransientError({ status: 401 }), false);
  });

  it("withExponentialBackoff retries then succeeds", async () => {
    let n = 0;
    const out = await withExponentialBackoff(
      async () => {
        n += 1;
        if (n < 3) {
          const e = new Error("rate limit");
          e.status = 429;
          throw e;
        }
        return "ok";
      },
      { retries: 5, baseMs: 1, maxDelayMs: 5, strategy: "none" }
    );
    assert.equal(out, "ok");
    assert.equal(n, 3);
  });
});
