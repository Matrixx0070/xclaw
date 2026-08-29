/**
 * `validateConfig` checks the retry block with relational operators:
 *
 *   if (retry.retries != null && (retry.retries < 0 || retry.retries > 20))
 *
 * Every relational comparison against a non-number is false, so the guard that
 * exists to reject bad retry settings cannot reject a non-numeric one. It says
 * "must be 0–20" and accepts "two".
 *
 * What it accepts then breaks the primitive it feeds. `withBackoff` does
 * `Math.max(0, opts.retries ?? 3)` and loops `attempt <= retries`; with NaN the
 * loop body never runs, so `fn` is NEVER CALLED and the function falls through
 * to `throw lastErr` — throwing a bare `undefined`. A retry helper that
 * silently declines to attempt the call even once is the worst outcome
 * available to it, and `undefined` is not an Error, so every downstream
 * `catch (e) { e.message }` reads nothing.
 *
 * The sibling values are the same shape one layer down: a non-numeric `baseMs`
 * or `maxDelayMs` makes every computed delay NaN, and `if (ms <= 0)` is false
 * for NaN, so the timer is armed with NaN — which setTimeout coerces to 0.
 * Backoff does not lengthen or shorten; it disappears, precisely when the thing
 * being retried is a 429 or an overload.
 *
 * Note which values the guard did catch: 99 and -1, both harmless (100 attempts
 * and a clamped single attempt). It rejected the benign values and certified
 * the catastrophic one.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateConfig } from "../src/config/validate.mjs";
import {
  withBackoff,
  createBackoff,
  exponentialBackoffMs,
  decorrelatedBackoffMs,
} from "../src/utils/backoff.mjs";

const errsFor = (retry) => validateConfig({ retry: { ...retry } }).errors;
const rejects = (retry) => errsFor(retry).some((e) => e.startsWith("retry."));

function failing() {
  let calls = 0;
  const fn = async () => {
    calls++;
    throw Object.assign(new Error("boom"), { status: 429 });
  };
  return { fn, calls: () => calls };
}

describe("a retry range check must reject a value that is not a number", () => {
  it("rejects a non-numeric retries count", () => {
    assert.ok(rejects({ retries: "two" }), 'retry.retries "two" was accepted as valid');
  });

  it("rejects a retries count that is not a scalar at all", () => {
    assert.ok(rejects({ retries: {} }), "retry.retries {} was accepted as valid");
  });

  it("rejects a non-numeric baseMs", () => {
    assert.ok(rejects({ baseMs: "fast" }), 'retry.baseMs "fast" was accepted as valid');
  });

  it("rejects a non-numeric maxDelayMs", () => {
    assert.ok(rejects({ baseMs: 100, maxDelayMs: "none" }), 'retry.maxDelayMs "none" was accepted');
  });

  it("still accepts a sane retry block", () => {
    assert.deepEqual(errsFor({ retries: 3, baseMs: 200, maxDelayMs: 30_000 }), []);
  });

  it("still rejects an out-of-range retries count", () => {
    assert.ok(rejects({ retries: 99 }), "retry.retries 99 must still be rejected");
    assert.ok(rejects({ retries: -1 }), "retry.retries -1 must still be rejected");
  });

  it("still accepts retries: 0 — no retries is a setting, not an absent one", () => {
    assert.deepEqual(errsFor({ retries: 0 }), []);
  });

  it("still rejects a maxDelayMs below baseMs", () => {
    assert.ok(rejects({ baseMs: 5000, maxDelayMs: 100 }), "cap below base must still be rejected");
  });
});

describe("a retry wrapper must always attempt the call", () => {
  it("calls the function even when the retries count is not a number", async () => {
    const { fn, calls } = failing();
    await assert.rejects(() => withBackoff(fn, { retries: "two", baseMs: 1, maxDelayMs: 2 }));
    assert.ok(calls() >= 1, `fn was never called (${calls()} calls) — the request never happened`);
  });

  it("throws a real error, never a bare undefined", async () => {
    const { fn } = failing();
    let caught = "nothing thrown";
    try {
      await withBackoff(fn, { retries: {}, baseMs: 1, maxDelayMs: 2 });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof Error, `threw ${caught === undefined ? "undefined" : caught}`);
    assert.equal(caught.message, "boom");
  });

  it("still honours a configured retry count", async () => {
    const { fn, calls } = failing();
    await assert.rejects(() => withBackoff(fn, { retries: 2, baseMs: 1, maxDelayMs: 2 }));
    assert.equal(calls(), 3, "one initial attempt plus two retries");
  });

  it("still honours retries: 0 — a single attempt, no retries", async () => {
    const { fn, calls } = failing();
    await assert.rejects(() => withBackoff(fn, { retries: 0, baseMs: 1, maxDelayMs: 2 }));
    assert.equal(calls(), 1);
  });
});

describe("backoff delays must stay real numbers", () => {
  it("does not collapse to no delay when baseMs is not a number", () => {
    const b = createBackoff({ baseMs: "fast", maxDelayMs: 15_000, strategy: "none" });
    const d = b.delayMs(0);
    assert.ok(Number.isFinite(d), `delay ${d} is not a finite number`);
    assert.ok(d > 0, `delay ${d} means retries fire with no backoff at all`);
  });

  it("does not collapse to no delay when the cap is not a number", () => {
    const b = createBackoff({ baseMs: 500, maxDelayMs: "none", strategy: "none" });
    const d = b.delayMs(0);
    assert.ok(Number.isFinite(d), `delay ${d} is not a finite number`);
    assert.ok(d > 0, `delay ${d} means retries fire with no backoff at all`);
  });

  it("does not collapse when the Retry-After jitter ratio is not a number", () => {
    const b = createBackoff({ baseMs: 500, maxDelayMs: 15_000, retryAfterJitterRatio: "some" });
    const d = b.delayMs(0, { retryAfter: "1" });
    assert.ok(Number.isFinite(d), `delay ${d} is not a finite number`);
    assert.ok(d >= 1000, `a Retry-After of 1s produced ${d}ms`);
  });

  it("does not collapse the Retry-After path when the cap is not a number", () => {
    // The Retry-After branch never reaches computeJitterDelay — it clamps with
    // createBackoff's OWN maxDelayMs, so this path needs its own guard.
    const b = createBackoff({ baseMs: 500, maxDelayMs: "none" });
    const d = b.delayMs(0, { retryAfter: "1" });
    assert.ok(Number.isFinite(d) && d >= 1000, `a Retry-After of 1s produced ${d}`);
  });

  it("does not collapse the Retry-After path when baseMs is not a number", () => {
    // baseMs feeds `Math.max(baseMs, maxDelayMs)`, so a bad base poisons the cap.
    const b = createBackoff({ baseMs: "fast", maxDelayMs: 15_000 });
    const d = b.delayMs(0, { retryAfter: "1" });
    assert.ok(Number.isFinite(d) && d >= 1000, `a Retry-After of 1s produced ${d}`);
  });

  it("keeps the exported delay helpers finite on a malformed base or cap", () => {
    // These call computeJitterDelay directly and pass the raw option through.
    const a = exponentialBackoffMs(0, { baseMs: "fast" });
    assert.ok(Number.isFinite(a) && a > 0, `exponentialBackoffMs gave ${a}`);
    const c = exponentialBackoffMs(3, { baseMs: 500, maxDelayMs: "none" });
    assert.ok(Number.isFinite(c) && c > 0, `exponentialBackoffMs gave ${c}`);
  });

  it("keeps decorrelated backoff finite when the previous delay is not a number", () => {
    const d = decorrelatedBackoffMs(1, {
      baseMs: 500, maxDelayMs: 15_000, prevDelayMs: "x", random: () => 0.5,
    });
    assert.ok(Number.isFinite(d) && d > 0, `decorrelatedBackoffMs gave ${d}`);
  });

  it("still produces the configured exponential delays", () => {
    const b = createBackoff({ baseMs: 500, maxDelayMs: 15_000, strategy: "none" });
    assert.deepEqual([0, 1, 2].map((a) => b.delayMs(a)), [500, 1000, 2000]);
  });
});
