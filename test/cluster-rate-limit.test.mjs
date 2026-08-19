import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit, resetRateLimits } from "../src/cluster/rate-limit.mjs";

describe("cluster rate limit", () => {
  it("trips after limit", () => {
    resetRateLimits();
    let last;
    for (let i = 0; i < 5; i++) {
      last = checkRateLimit("peer-1", { limit: 3, windowMs: 60_000 });
    }
    assert.equal(last.ok, false);
    assert.equal(last.code, "CLUSTER_RATE_LIMIT");
  });
});
