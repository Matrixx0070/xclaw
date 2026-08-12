import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  beforeNavigate,
  beforeInput,
  afterAction,
  buildChromeArgs,
  hooksStatus,
} from "../src/browser/hooks.mjs";
import {
  resolveHooksModulePath,
  loadHooks,
  runBeforeNavigate,
} from "../src/computer/hooks-bridge.mjs";
import { openCommitGate, resolveCommitGate } from "../src/browser/physics.mjs";

describe("Phase A2 driver hooks", () => {
  let tmp;
  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-a2-"));
    process.env.XCLAW_FABRIC_DIR = tmp;
    delete process.env.XCLAW_COMMIT_GATES;
    delete process.env.XCLAW_FABRIC_ENFORCE;
  });
  after(async () => {
    delete process.env.XCLAW_FABRIC_DIR;
    delete process.env.XCLAW_COMMIT_GATES;
    delete process.env.XCLAW_FABRIC_ENFORCE;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("buildChromeArgs ensures H0 invariants", async () => {
    const args = await buildChromeArgs(["--remote-debugging-port=0"]);
    assert.ok(args.includes("--remote-allow-origins=*"));
    assert.ok(args.includes("--disable-dev-shm-usage"));
  });

  it("beforeNavigate allows normal URL without enforcement", async () => {
    const r = await beforeNavigate({ url: "https://example.com/", role: "actor" });
    assert.equal(r.ok, true);
    assert.ok(r.actionId);
  });

  it("beforeNavigate blocks critic motor navigate", async () => {
    const r = await beforeNavigate({ url: "https://example.com/", role: "critic" });
    assert.equal(r.ok, false);
    assert.equal(r.code, "ROLE_NO_NAVIGATE");
  });

  it("beforeNavigate requires commit gate when enabled", async () => {
    process.env.XCLAW_COMMIT_GATES = "1";
    const r = await beforeNavigate({
      url: "https://shop.example/checkout",
      role: "actor",
      agentId: "a1",
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "COMMIT_GATE_REQUIRED");
    assert.ok(r.gate?.id);
    // approve and retry
    await resolveCommitGate(r.gate.id, "approve", { role: "critic", agentId: "c1" });
    const r2 = await beforeNavigate({
      url: "https://shop.example/checkout",
      role: "actor",
      agentId: "a1",
      tabId: r.gate.tabId,
    });
    // may still need matching gate url — approved gate without tab should match
    assert.equal(r2.ok, true, JSON.stringify(r2));
    delete process.env.XCLAW_COMMIT_GATES;
  });

  it("beforeInput blocks critic click", async () => {
    const r = await beforeInput({ role: "critic", action: "click" });
    assert.equal(r.ok, false);
  });

  it("afterAction returns actionId", async () => {
    const before = await beforeInput({ role: "actor" });
    const after = await afterAction(before, {});
    assert.equal(after.ok, true);
    assert.ok(after.actionId);
  });

  it("hooks-bridge resolves and loads", async () => {
    process.env.XCLAW_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
    // test runs from package; cwd may be package root when node --test
    const p = resolveHooksModulePath();
    assert.ok(p && p.includes("hooks.mjs"), p);
    const h = await loadHooks();
    assert.ok(h.beforeNavigate);
    const r = await runBeforeNavigate({ url: "https://example.com", role: "actor" });
    assert.equal(r.ok, true);
  });

  it("hooksStatus reports flags", () => {
    const st = hooksStatus();
    assert.ok("commitGates" in st);
    assert.ok("fabricEnforce" in st);
  });
});
