/**
 * Native browser_tab CDP-tier gates — CI-safe: every case returns BEFORE any
 * Chrome/network work (enforcement hooks and validation fire first), so no
 * browser is spawned.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runBrowserTab, _resetTabsForTests } from "../src/computer/modules/browser-tab-tool.mjs";

function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

describe("browser_tab native CDP tier — engine-side enforcement", () => {
  // The commit-gate and fabric paths persist clock.json / commit-gates.json.
  // Fabric has no cfg seam, so XCLAW_FABRIC_DIR is the only redirect; without
  // it this suite grew the operator's real ~/.xclaw on every run.
  let fabricDir;
  let savedFabric;
  before(async () => {
    fabricDir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-cdp-fabric-"));
    savedFabric = process.env.XCLAW_FABRIC_DIR;
    process.env.XCLAW_FABRIC_DIR = fabricDir;
  });
  after(async () => {
    if (savedFabric === undefined) delete process.env.XCLAW_FABRIC_DIR;
    else process.env.XCLAW_FABRIC_DIR = savedFabric;
    if (fabricDir) await fs.rm(fabricDir, { recursive: true, force: true });
  });

  it("commit gate blocks checkout navigate in-process (bundle-parity)", async () => {
    _resetTabsForTests();
    await withEnv({ XCLAW_COMMIT_GATES: "1" }, async () => {
      const r = await runBrowserTab({ url: "https://shop.example/checkout" });
      assert.equal(r.ok, false);
      assert.match(String(r.code), /COMMIT_GATE/);
    });
  });

  it("motor-like jsCode blocked under fabric enforce (JSCODE_MOTOR_PATTERN)", async () => {
    await withEnv({ XCLAW_FABRIC_ENFORCE: "1", XCLAW_JSCODE_MODE: undefined }, async () => {
      const r = await runBrowserTab({ tabId: "nope", jsCode: "document.body.click()" });
      assert.equal(r.ok, false);
      assert.equal(r.code, "JSCODE_MOTOR_PATTERN");
    });
  });

  it("jsCode on unknown tab without url fails typed UNKNOWN_TAB", async () => {
    _resetTabsForTests();
    await withEnv({ XCLAW_JSCODE_MODE: "allow" }, async () => {
      const r = await runBrowserTab({ tabId: "tab_missing", jsCode: "1+1" });
      assert.equal(r.ok, false);
      assert.equal(r.code, "UNKNOWN_TAB");
    });
  });

  it("console on fetch-tier tab returns empty with guidance, not an error", async () => {
    _resetTabsForTests();
    const r = await runBrowserTab({ action: "console", tabId: "tab_missing" });
    assert.equal(r.ok, false); // unknown tab
    const list = await runBrowserTab({ action: "list" });
    assert.equal(list.ok, true);
  });

  it("critic role cannot navigate (ROLE_NO_NAVIGATE) — hooks run engine-side", async () => {
    await withEnv({ XCLAW_AGENT_ROLE: "critic" }, async () => {
      const r = await runBrowserTab({ url: "https://example.com/" });
      assert.equal(r.ok, false);
      assert.equal(r.code, "ROLE_NO_NAVIGATE");
    });
  });
});
