import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  acquireTabLease,
  releaseTabLease,
  requireTabLease,
  listTabLeases,
  openCommitGate,
  resolveCommitGate,
  requireCommitGate,
  isCommitSensitive,
  fabricStatus,
  roleCaps,
  assertMotorAllowed,
  tickClock,
} from "../src/browser/physics.mjs";
import { createBrowserTools } from "../src/tools/browser-tools.mjs";

describe("Horizon 4 Session Physics", () => {
  let tmp;
  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-fabric-"));
    process.env.XCLAW_FABRIC_DIR = tmp;
  });
  after(async () => {
    delete process.env.XCLAW_FABRIC_DIR;
    delete process.env.XCLAW_COMMIT_GATES;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("roleCaps: critic has no motor", () => {
    assert.equal(roleCaps("critic").motor, false);
    assert.equal(roleCaps("actor").motor, true);
    assert.equal(assertMotorAllowed("critic", "click").ok, false);
    assert.equal(assertMotorAllowed("actor", "click").ok, true);
  });

  it("tab lease exclusive between agents", async () => {
    const a = await acquireTabLease("tab1", { agentId: "agent-a", role: "actor" });
    assert.equal(a.ok, true);
    const b = await acquireTabLease("tab1", { agentId: "agent-b", role: "actor" });
    assert.equal(b.ok, false);
    assert.equal(b.code, "TAB_LEASE_HELD");
    const rel = await releaseTabLease("tab1", { agentId: "agent-a" });
    assert.equal(rel.ok, true);
    const c = await acquireTabLease("tab1", { agentId: "agent-b", role: "actor" });
    assert.equal(c.ok, true);
    await releaseTabLease("tab1", { agentId: "agent-b" });
  });

  it("requireTabLease fails without lease", async () => {
    const r = await requireTabLease("tab-x", { agentId: "z", autoAcquire: false });
    assert.equal(r.ok, false);
    assert.equal(r.code, "TAB_LEASE_MISSING");
  });

  it("isCommitSensitive detects checkout/pay", () => {
    assert.equal(isCommitSensitive("https://shop.com/checkout"), true);
    assert.equal(isCommitSensitive("https://bank.com/transfer"), true);
    assert.equal(isCommitSensitive("https://example.com/about"), false);
  });

  it("commit gate open → critic approve", async () => {
    const opened = await openCommitGate({
      url: "https://shop.com/checkout",
      agentId: "actor-1",
    });
    assert.equal(opened.ok, true);
    const denied = await resolveCommitGate(opened.gate.id, "approve", {
      role: "actor",
      agentId: "actor-1",
    });
    assert.equal(denied.ok, false);
    const ok = await resolveCommitGate(opened.gate.id, "approve", {
      role: "critic",
      agentId: "critic-1",
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.gate.status, "approved");
  });

  it("requireCommitGate blocks when enabled and no approval", async () => {
    process.env.XCLAW_COMMIT_GATES = "1";
    const r = await requireCommitGate("https://pay.example.com/pay", {
      agentId: "a1",
      forceCheck: true,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "COMMIT_GATE_REQUIRED");
    assert.ok(r.gate?.id);
  });

  it("fabricStatus and clock advance", async () => {
    const n1 = await tickClock("test");
    const n2 = await tickClock("test2");
    assert.ok(n2 > n1);
    const st = await fabricStatus();
    assert.ok(st.fabricDir.includes(tmp) || st.clock >= n2);
    assert.ok(Array.isArray(st.roles));
  });

  it("tools registered", () => {
    const names = createBrowserTools({}).map((t) => t.name);
    assert.ok(names.includes("tab_lease"));
    assert.ok(names.includes("commit_gate"));
    assert.ok(names.includes("fabric_status"));
  });
});
