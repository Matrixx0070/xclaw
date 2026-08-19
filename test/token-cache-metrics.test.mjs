import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  recordToolTokens,
  toolCacheHitRate,
  resetTokenCache,
  snapshotTokenCache,
} from "../src/agent/token-cache-metrics.mjs";

describe("token cache metrics", () => {
  it("tracks hit rate per tool", () => {
    resetTokenCache();
    recordToolTokens("xclaw_bash", { prompt: 100, completion: 20, cached: 40 });
    recordToolTokens("xclaw_bash", { prompt: 100, completion: 10, cached: 60 });
    assert.equal(toolCacheHitRate("xclaw_bash"), 0.5);
    const snap = snapshotTokenCache();
    assert.equal(snap.xclaw_bash.calls, 2);
  });
});
