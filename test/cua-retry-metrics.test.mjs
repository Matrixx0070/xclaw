import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getCuaRetryMetrics,
  resetCuaRetryMetrics,
} from "../src/computer/cua-retry-metrics.mjs";
import { withCuaRetry } from "../src/computer/cua-retry.mjs";

describe("CUA retry metrics", () => {
  it("records retries and success", async () => {
    resetCuaRetryMetrics();
    let n = 0;
    await withCuaRetry(
      async () => {
        n += 1;
        if (n < 3) return { ok: false, code: "CDP_ATTACH_FAILED", error: "x" };
        return { ok: true };
      },
      { retries: 3, baseMs: 1, maxMs: 5, jitter: 0 }
    );
    const m = getCuaRetryMetrics();
    assert.ok(m.retries >= 2);
    assert.equal(m.successes, 1);
    assert.ok(m.retriedSuccesses >= 1);
    assert.ok(m.byCode.CDP_ATTACH_FAILED?.retries >= 2);
  });

  it("does not count permanent as retries", async () => {
    resetCuaRetryMetrics();
    await withCuaRetry(
      async () => ({ ok: false, code: "DESKTOP_GUI_DISABLED", error: "off" }),
      { retries: 3, baseMs: 1, maxMs: 5, jitter: 0 }
    );
    const m = getCuaRetryMetrics();
    assert.equal(m.retries, 0);
    assert.equal(m.failures, 1);
  });
});
