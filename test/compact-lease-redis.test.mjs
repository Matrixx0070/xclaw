import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { acquireRedisLease, releaseRedisLease } from "../src/cluster/compact-lease-redis.mjs";

function mockRedis() {
  const store = new Map();
  return {
    async set(k, v, _pxk, _px, nx) {
      if (nx === "NX" && store.has(k)) return null;
      store.set(k, v);
      return "OK";
    },
    async get(k) {
      return store.get(k) ?? null;
    },
    async del(k) {
      store.delete(k);
    },
  };
}

describe("redis compact lease", () => {
  it("prod fails closed without client", async () => {
    const r = await acquireRedisLease(
      { profile: "prod", cluster: { compactLeaseBackend: "redis", requireRedisLease: true } },
      "us"
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, "REDIS_UNAVAILABLE");
    assert.equal(r.failClosed, true);
  });
  it("SET NX then owner-checked release", async () => {
    const redis = mockRedis();
    const cfg = { cluster: { compactLeaseBackend: "redis" }, redis };
    const a = await acquireRedisLease(cfg, "us", { owner: "gw-a" });
    assert.equal(a.ok, true);
    const b = await acquireRedisLease(cfg, "us", { owner: "gw-b" });
    assert.equal(b.ok, false);
    const bad = await releaseRedisLease(cfg, "us", { owner: "gw-b" });
    assert.equal(bad.ok, false);
    const ok = await releaseRedisLease(cfg, "us", { owner: "gw-a" });
    assert.equal(ok.ok, true);
  });
});
