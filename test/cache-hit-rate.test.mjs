import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeUsage } from "../src/tokens/count.mjs";
import { createUsageTracker } from "../src/tokens/usage-tracker.mjs";
import { aggregateCacheStats, cacheStatsFromUsage } from "../src/tokens/cache-strategy.mjs";

describe("cache hit rate tracking", () => {
  it("normalizeUsage reads xAI prompt_tokens_details.cached_tokens", () => {
    const n = normalizeUsage({
      prompt_tokens: 1000,
      completion_tokens: 50,
      prompt_tokens_details: { cached_tokens: 400 },
    });
    assert.equal(n.cachedTokens, 400);
    assert.equal(n.promptTokens, 1000);
  });

  it("normalizeUsage reads Anthropic cache_read_input_tokens", () => {
    const n = normalizeUsage({
      input_tokens: 2000,
      output_tokens: 100,
      cache_read_input_tokens: 1500,
      cache_creation_input_tokens: 200,
    });
    assert.equal(n.cachedTokens, 1500);
    assert.equal(n.cacheCreationTokens, 200);
  });

  it("usage tracker snapshot exposes cacheHitRatePct", () => {
    const t = createUsageTracker({ enabled: true, model: "grok-4.3" });
    t.recordTurn({
      turn: 1,
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 10,
        prompt_tokens_details: { cached_tokens: 250 },
      },
    });
    const s = t.snapshot();
    assert.equal(s.cachedTokens, 250);
    assert.equal(s.cacheHitRatePct, 25);
    assert.ok(s.turns[0].cacheHitRate === 0.25);
  });

  it("aggregateCacheStats computes hit rate across turns", () => {
    const agg = aggregateCacheStats([
      { promptTokens: 1000, cachedTokens: 500 },
      { promptTokens: 1000, cachedTokens: 0 },
      { promptTokens: 500, cachedTokens: 100, estimated: true }, // skipped
    ]);
    assert.equal(agg.promptTokens, 2000);
    assert.equal(agg.cachedTokens, 500);
    assert.equal(agg.hitRatePct, 25);
    assert.equal(agg.turnsWithCache, 1);
  });

  it("cacheStatsFromUsage handles missing prompt", () => {
    const s = cacheStatsFromUsage({ cachedTokens: 10 });
    assert.equal(s.hitRate, 0);
  });
});
