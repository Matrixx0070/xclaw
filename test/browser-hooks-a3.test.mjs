import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  beforeNavigate,
  beforeInput,
  afterAction,
} from "../src/browser/hooks.mjs";
import {
  acquireTabLease,
  releaseTabLease,
} from "../src/browser/physics.mjs";

describe("Phase A3 fabric on more paths", () => {
  let tmp;
  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-a3-"));
    process.env.XCLAW_FABRIC_DIR = tmp;
    process.env.XCLAW_FABRIC_ENFORCE = "1";
    delete process.env.XCLAW_TAB_LEASE_AUTO;
    delete process.env.XCLAW_COMMIT_GATES;
  });
  after(async () => {
    delete process.env.XCLAW_FABRIC_DIR;
    delete process.env.XCLAW_FABRIC_ENFORCE;
    delete process.env.XCLAW_TAB_LEASE_AUTO;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("beforeInput without lease fails when fabric enforce + tabId", async () => {
    const r = await beforeInput({
      tabId: "t99",
      role: "actor",
      roleTrusted: true,
      agentId: "agent-x",
      action: "evaluate",
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "TAB_LEASE_MISSING");
  });

  it("beforeInput succeeds after acquire lease", async () => {
    const acq = await acquireTabLease("t1", { agentId: "agent-a", role: "actor" });
    assert.equal(acq.ok, true);
    const r = await beforeInput({
      tabId: "t1",
      role: "actor",
      roleTrusted: true,
      agentId: "agent-a",
      action: "evaluate",
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    await releaseTabLease("t1", { agentId: "agent-a" });
  });

  it("second agent cannot act on first agent lease", async () => {
    await acquireTabLease("t2", { agentId: "agent-a", role: "actor" });
    const r = await beforeInput({
      tabId: "t2",
      role: "actor",
      roleTrusted: true,
      agentId: "agent-b",
      action: "evaluate",
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "TAB_LEASE_HELD");
    await releaseTabLease("t2", { agentId: "agent-a" });
  });

  it("observer can observe without motor lease conflict on read-only", async () => {
    // no tabId — observe allowed for observer
    const r = await beforeInput({
      role: "observer",
      agentId: "obs-1",
      action: "observe",
    });
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it("observer cannot evaluate (motor) under fabric", async () => {
    const r = await beforeInput({
      role: "observer",
      agentId: "obs-1",
      action: "evaluate",
    });
    assert.equal(r.ok, false);
    assert.ok(r.code === "ROLE_NO_MOTOR" || r.code === "TAB_LEASE_MISSING");
  });

  it("auto-acquire grants lease when enabled", async () => {
    process.env.XCLAW_TAB_LEASE_AUTO = "1";
    const r = await beforeInput({
      tabId: "t-auto",
      role: "actor",
      roleTrusted: true,
      agentId: "agent-auto",
      action: "evaluate",
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    await releaseTabLease("t-auto", { agentId: "agent-auto" });
    delete process.env.XCLAW_TAB_LEASE_AUTO;
  });

  it("navigate still requires commit gate when gated", async () => {
    process.env.XCLAW_COMMIT_GATES = "1";
    process.env.XCLAW_FABRIC_ENFORCE = "0";
    const r = await beforeNavigate({
      url: "https://bank.example/transfer",
      role: "actor",
      roleTrusted: true,
      agentId: "a1",
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "COMMIT_GATE_REQUIRED");
    delete process.env.XCLAW_COMMIT_GATES;
    process.env.XCLAW_FABRIC_ENFORCE = "1";
  });
});
