import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  acquireSoakLease,
  releaseSoakLease,
} from "../src/eval/horizon-soak-lease.mjs";
import {
  acquireSoakLeaseRedis,
  releaseSoakLeaseRedis,
} from "../src/eval/horizon-soak-lease-redis.mjs";
import { soakLeaseBackend } from "../src/eval/horizon-soak-lease-select.mjs";
import {
  resetSoakLeaseMetrics,
  getSoakLeaseDeniedTotal,
} from "../src/eval/horizon-soak-lease-metrics.mjs";
import { runHorizonLive } from "../src/eval/horizon-live.mjs";
import { doctorHorizon } from "../src/cli/doctor-horizon.mjs";

function memoryRedis() {
  const store = new Map();
  return {
    async set(key, val, opts = {}) {
      if (opts.NX && store.has(key)) return null;
      store.set(key, val);
      return "OK";
    },
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async del(key) {
      store.delete(key);
    },
    async pexpire() {},
  };
}

describe("horizon soak lease", () => {
  it("file backend: second owner denied", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-lease-"));
    const a = acquireSoakLease("job-a", {
      base,
      owner: "node-1",
      ttlMs: 60_000,
    });
    assert.equal(a.ok, true);
    const b = acquireSoakLease("job-a", {
      base,
      owner: "node-2",
      ttlMs: 60_000,
    });
    assert.equal(b.ok, false);
    assert.equal(b.code, "LEASE_HELD");
    const rel = releaseSoakLease("job-a", { base, owner: "node-1" });
    assert.equal(rel.ok, true);
    const c = acquireSoakLease("job-a", {
      base,
      owner: "node-2",
      ttlMs: 60_000,
    });
    assert.equal(c.ok, true);
    releaseSoakLease("job-a", { base, owner: "node-2" });
  });

  it("redis backend: SET NX conflict", async () => {
    const redis = memoryRedis();
    const a = await acquireSoakLeaseRedis("r1", {
      redis,
      owner: "n1",
      ttlMs: 30_000,
    });
    assert.equal(a.ok, true);
    const b = await acquireSoakLeaseRedis("r1", {
      redis,
      owner: "n2",
      ttlMs: 30_000,
    });
    assert.equal(b.ok, false);
    assert.equal(b.code, "LEASE_HELD");
    await releaseSoakLeaseRedis("r1", { redis, owner: "n1" });
  });

  it("live: second node blocked while first holds", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-lease2-"));
    process.env.XAI_API_KEY = process.env.XAI_API_KEY || "test-key-not-real";
    resetSoakLeaseMetrics();
    const held = acquireSoakLease("live-job", {
      base,
      owner: "holder",
      ttlMs: 60_000,
    });
    assert.equal(held.ok, true);

    const r = await runHorizonLive({
      requireLive: true,
      soakJobId: "live-job",
      soakBase: base,
      leaseOwner: "challenger",
      maxUsd: 5,
      maxTurns: 8,
      runAgent: async () => ({ ok: true }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.mode, "lease_denied");
    assert.ok(getSoakLeaseDeniedTotal() >= 1);
    releaseSoakLease("live-job", { base, owner: "holder" });
  });

  it("selector defaults to file", () => {
    assert.equal(soakLeaseBackend({}), "file");
  });

  it("doctor exposes lease backend", async () => {
    const d = await doctorHorizon({});
    assert.equal(d.leaseBackend, "file");
    assert.ok(Array.isArray(d.heldLeases));
    assert.ok(d.metricsLease);
  });
});
