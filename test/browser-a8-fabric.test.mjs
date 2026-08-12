import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withFabricLock, acquireFabricLock } from "../src/browser/fabric-lock.mjs";
import {
  acquireTabLease,
  releaseTabLease,
  renewTabLease,
  openCommitGate,
  resolveCommitGate,
} from "../src/browser/physics.mjs";
import { bindRole, getBoundRole } from "../src/browser/role-binding.mjs";

describe("A8 fabric durability", () => {
  let tmp;
  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-a8-"));
    process.env.XCLAW_FABRIC_DIR = tmp;
  });
  after(async () => {
    delete process.env.XCLAW_FABRIC_DIR;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("withFabricLock serializes concurrent writers", async () => {
    const order = [];
    await Promise.all([
      withFabricLock(async () => {
        order.push("a-start");
        await new Promise((r) => setTimeout(r, 40));
        order.push("a-end");
      }),
      withFabricLock(async () => {
        order.push("b-start");
        await new Promise((r) => setTimeout(r, 10));
        order.push("b-end");
      }),
    ]);
    // one fully before the other
    const aFirst = order.indexOf("a-end") < order.indexOf("b-start");
    const bFirst = order.indexOf("b-end") < order.indexOf("a-start");
    assert.ok(aFirst || bFirst, JSON.stringify(order));
  });

  it("acquire + renew heartbeat extends ttl", async () => {
    const a = await acquireTabLease("t-hb", { agentId: "agent-a", role: "actor", ttlMs: 5000 });
    assert.equal(a.ok, true);
    const before = a.lease.expiresAt;
    await new Promise((r) => setTimeout(r, 30));
    const r = await renewTabLease("t-hb", { agentId: "agent-a", ttlMs: 60_000 });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.lease.expiresAt > before);
    assert.equal(r.lease.heartbeatCount, 1);
    await releaseTabLease("t-hb", { agentId: "agent-a" });
  });

  it("second agent cannot steal lease under lock", async () => {
    await acquireTabLease("t-steal", { agentId: "a1", role: "actor", ttlMs: 60_000 });
    const b = await acquireTabLease("t-steal", { agentId: "a2", role: "actor", ttlMs: 60_000 });
    assert.equal(b.ok, false);
    assert.equal(b.code, "TAB_LEASE_HELD");
    await releaseTabLease("t-steal", { agentId: "a1" });
  });

  it("commit gate open/resolve under lock", async () => {
    const o = await openCommitGate({ url: "https://x/checkout", agentId: "a1" });
    assert.equal(o.ok, true);
    const res = await resolveCommitGate(o.gate.id, "approve", { role: "critic", agentId: "c1" });
    assert.equal(res.ok, true);
    assert.equal(res.gate.status, "approved");
  });

  it("role bind under lock persists", async () => {
    await bindRole("sess-a8", "actor");
    const g = await getBoundRole("sess-a8");
    assert.equal(g.role, "actor");
  });

  it("parallel acquires on different tabs succeed", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        acquireTabLease(`t-par-${i}`, { agentId: `ag-${i}`, role: "actor", ttlMs: 30_000 })
      )
    );
    assert.ok(results.every((r) => r.ok));
    await Promise.all(
      results.map((r, i) => releaseTabLease(`t-par-${i}`, { agentId: `ag-${i}` }))
    );
  });
});
