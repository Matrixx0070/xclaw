/**
 * Feature 5 — rate limit + allowlist helpers
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter, RATE_LIMITED } from "../src/channels/rate-limit.mjs";
import { processInbound } from "../src/channels/runtime.mjs";

describe("telegram hardening units", () => {
  it("rate limiter trips", () => {
    const rl = createRateLimiter({ max: 2, windowMs: 60_000 });
    assert.equal(rl.allow("c1").ok, true);
    assert.equal(rl.allow("c1").ok, true);
    const third = rl.allow("c1");
    assert.equal(third.ok, false);
    assert.ok(third.retryAfterMs >= 0);
  });

  it("processInbound returns RATE_LIMITED", async () => {
    const rl = createRateLimiter({ max: 1, windowMs: 60_000 });
    const inbound = {
      channel: "telegram",
      chatId: "99",
      userId: "u1",
      text: "hello",
      identity: {},
    };
    const a = await processInbound(inbound, {
      cfg: {},
      rateLimiter: rl,
      replyWithAgent: async () => ({ text: "ok" }),
    });
    assert.equal(a.via, "agent");
    const b = await processInbound(inbound, {
      cfg: {},
      rateLimiter: rl,
      replyWithAgent: async () => ({ text: "ok" }),
    });
    assert.equal(b.code, RATE_LIMITED);
    assert.equal(b.via, "rate_limit");
  });

  it("RATE_LIMITED constant", () => {
    assert.equal(RATE_LIMITED, "RATE_LIMITED");
  });
});
