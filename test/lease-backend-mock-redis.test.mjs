import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { acquireLease, releaseLease } from "../src/tokens/ledger-lease-redis.mjs";

function mockRedis() {
  const store = new Map();
  return {
    async set(k, v, ...args) {
      const nx = args.includes("NX");
      if (nx && store.has(k)) return null;
      store.set(k, { v, px: 30000 });
      return "OK";
    },
    async get(k) {
      return store.get(k)?.v ?? null;
    },
    async pexpire() {
      return 1;
    },
    async del(k) {
      store.delete(k);
      return 1;
    },
  };
}

describe("mock redis lease NX", () => {
  it("second acquire fails", async () => {
    const redis = mockRedis();
    const cfg = { redis };
    const a = await acquireLease(cfg, { owner: "a", ttlMs: 30_000 });
    assert.equal(a.ok, true);
    const b = await acquireLease(cfg, { owner: "b", ttlMs: 30_000 });
    assert.equal(b.ok, false);
    assert.equal(b.reason, "lease_held");
    await releaseLease(cfg, { owner: "a" });
    const c = await acquireLease(cfg, { owner: "b", ttlMs: 30_000 });
    assert.equal(c.ok, true);
  });
});
