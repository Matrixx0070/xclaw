import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyFailure, recoveryStrategyFor } from "../src/jobs/checkpoint.mjs";
import { withBackoff, fullJitterBackoffMs } from "../src/utils/backoff.mjs";

describe("resume retry logic", () => {
  it("transport kind is classified from connection errors", () => {
    assert.equal(classifyFailure("ECONNREFUSED 127.0.0.1"), "transport");
    assert.equal(classifyFailure("computer not healthy"), "transport");
  });

  it("withBackoff retries transient then succeeds", async () => {
    let n = 0;
    const out = await withBackoff(
      async () => {
        n += 1;
        if (n < 3) {
          const e = new Error("ECONNREFUSED");
          e.code = "TRANSIENT_RESUME";
          throw e;
        }
        return { ok: true, n };
      },
      {
        retries: 3,
        baseMs: 5,
        maxDelayMs: 20,
        strategy: "none",
        shouldRetry: (err) => err?.code === "TRANSIENT_RESUME",
      }
    );
    assert.equal(out.ok, true);
    assert.equal(out.n, 3);
  });

  it("backoff delays grow", () => {
    const a = fullJitterBackoffMs(0, { baseMs: 100, maxDelayMs: 10_000, random: () => 0.5 });
    const b = fullJitterBackoffMs(3, { baseMs: 100, maxDelayMs: 10_000, random: () => 0.5 });
    assert.ok(b >= a);
  });

  it("recovery transport plan is defined", () => {
    const p = recoveryStrategyFor("transport", { turns: 2, maxTurns: 12 });
    assert.equal(p.strategy, "transport");
    assert.ok(p.goalSuffix.includes("RECOVERY:transport"));
  });
});
