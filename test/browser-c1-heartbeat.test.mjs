import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  acquireWithHeartbeat,
  touchLease,
  startLeaseHeartbeat,
  stopLeaseHeartbeat,
  listLeaseHeartbeats,
  stopAllLeaseHeartbeats,
} from "../src/browser/lease-heartbeat.mjs";
import { releaseTabLease } from "../src/browser/physics.mjs";

describe("C1 lease heartbeat", () => {
  let tmp;
  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-c1-"));
    process.env.XCLAW_FABRIC_DIR = tmp;
    process.env.XCLAW_TAB_LEASE_TTL_MS = "3000";
    process.env.XCLAW_TAB_LEASE_HEARTBEAT_MS = "500";
    delete process.env.XCLAW_TAB_LEASE_HEARTBEAT;
  });
  after(async () => {
    stopAllLeaseHeartbeats();
    delete process.env.XCLAW_FABRIC_DIR;
    delete process.env.XCLAW_TAB_LEASE_TTL_MS;
    delete process.env.XCLAW_TAB_LEASE_HEARTBEAT_MS;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("acquireWithHeartbeat starts interval", async () => {
    const r = await acquireWithHeartbeat("t-hb1", {
      agentId: "agent-c1",
      role: "actor",
      ttlMs: 3000,
      intervalMs: 500,
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.heartbeat?.ok, true);
    const list = listLeaseHeartbeats();
    assert.ok(list.some((x) => x.tabId === "t-hb1"));
    stopLeaseHeartbeat("t-hb1");
    await releaseTabLease("t-hb1", { agentId: "agent-c1" });
  });

  it("touchLease extends expiry", async () => {
    const a = await acquireWithHeartbeat("t-hb2", {
      agentId: "agent-c1",
      role: "actor",
      ttlMs: 2000,
    });
    const before = a.lease.expiresAt;
    await new Promise((r) => setTimeout(r, 50));
    const t = await touchLease("t-hb2", { agentId: "agent-c1", ttlMs: 10_000 });
    assert.equal(t.ok, true, JSON.stringify(t));
    assert.ok(t.lease.expiresAt >= before);
    stopLeaseHeartbeat("t-hb2");
    await releaseTabLease("t-hb2", { agentId: "agent-c1" });
  });

  it("interval renew keeps lease alive past original ttl", async () => {
    await acquireWithHeartbeat("t-hb3", {
      agentId: "agent-c1",
      role: "actor",
      ttlMs: 800,
      intervalMs: 200,
    });
    await new Promise((r) => setTimeout(r, 1200));
    const t = await touchLease("t-hb3", { agentId: "agent-c1" });
    // still renewable by same agent means lease was kept alive
    assert.equal(t.ok, true, JSON.stringify(t));
    stopLeaseHeartbeat("t-hb3");
    await releaseTabLease("t-hb3", { agentId: "agent-c1" });
  });

  it("stopLeaseHeartbeat removes from list", async () => {
    startLeaseHeartbeat("t-x", { agentId: "a", intervalMs: 60_000 });
    assert.ok(listLeaseHeartbeats().some((x) => x.tabId === "t-x"));
    stopLeaseHeartbeat("t-x");
    assert.ok(!listLeaseHeartbeats().some((x) => x.tabId === "t-x"));
  });
});
