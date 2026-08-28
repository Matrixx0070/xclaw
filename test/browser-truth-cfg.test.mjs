// Pins that the browser truth/policy/bindings plane honours cfg.
//
// Two families of code resolve the mitm confdir. The proxy plane always
// threaded cfg through mitmConfdir(cfg); the truth plane dropped it at every
// site, so with browser.mitm.confdir configured the two subsystems disagreed
// about which directory they were talking about. Consequences, in order of
// severity:
//
//   1. mitm_policy set wrote block/require rules into the DEFAULT dir while the
//      running proxy read the CONFIGURED one — security rules silently inert.
//      savePolicy already had a cfg parameter and no caller passed it.
//   2. exportProofBundle stamped mitmEnabled:false and the default confdir into
//      every audit bundle regardless of configuration — an artifact that
//      misreports its own provenance is worse than a missing one.
//   3. action bindings were written to one dir and read back from another, so
//      require-rule evaluation saw no bindings for actions that had them.
//
// XCLAW_MITM_CONFDIR outranks cfg (see mitmConfdir), so it must be UNSET here
// or every assertion below passes for the wrong reason — the env var is exactly
// the input under which the cfg path is never exercised. Assertions are
// positive-path (the artifact lands at the cfg dir) because the no-cfg path
// resolves to the operator's real home, which tests must never touch.

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  savePolicy,
  loadPolicy,
  exportProofBundle,
} from "../src/browser/truth.mjs";
import { bindActionFlows, readActionBindings } from "../src/browser/sense.mjs";
import { loadTimeline } from "../src/browser/timetravel.mjs";
import { createBrowserTools } from "../src/tools/browser-tools.mjs";

let root;
let confdir;
let cfg;
const savedEnv = {};

before(async () => {
  // loadPolicy also merges env-derived rules, so those must be cleared too or
  // an ambient XCLAW_MITM_BLOCK leaks into the round-trip assertions.
  for (const k of [
    "XCLAW_MITM_CONFDIR",
    "XCLAW_MITM",
    "XCLAW_MITM_BLOCK",
    "XCLAW_MITM_MAP",
    "XCLAW_MITM_ALLOWLIST",
  ]) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  root = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-truth-cfg-"));
});

after(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (root) await fs.rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  confdir = await fs.mkdtemp(path.join(root, "cd-"));
  cfg = { browser: { mitm: { enabled: true, confdir } } };
});

describe("browser truth plane honours cfg.browser.mitm.confdir", () => {
  it("savePolicy/loadPolicy round-trip through the configured dir", async () => {
    const rules = [
      { id: "r1", action: "block", match: { hostOrPathContains: "evil.example" } },
    ];
    const r = await savePolicy({ version: 1, rules }, cfg);
    assert.equal(r.path, path.join(confdir, "policy.json"));

    const onDisk = JSON.parse(await fs.readFile(r.path, "utf8"));
    assert.deepEqual(onDisk.rules, rules);

    const back = await loadPolicy(cfg);
    assert.deepEqual(back.rules, rules);
  });

  it("mitm_policy set writes where the proxy reads", async () => {
    // The shipped defect: the tool dropped cfg, so a rule set by the operator
    // never reached the directory the running proxy consults.
    const tools = createBrowserTools({
      computer: { async callTool() { return { content: [] }; } },
      sessionId: "cfg-test",
      workingDir: process.cwd(),
      cfg,
    });
    const tool = tools.find((t) => t.name === "mitm_policy");
    assert.ok(tool, "mitm_policy tool must be registered");

    const rules = [
      { id: "blocked", action: "block", match: { hosts: ["blocked.example"] } },
    ];
    const res = await tool.execute({ action: "set", rules });
    assert.ok(!res.isError, `set failed: ${JSON.stringify(res)}`);

    const onDisk = JSON.parse(
      await fs.readFile(path.join(confdir, "policy.json"), "utf8")
    );
    assert.deepEqual(onDisk.rules, rules);
  });

  it("action bindings are written to and read back from the configured dir", async () => {
    await bindActionFlows("act_cfg_1", [{ host: "a.example", url: "https://a.example/x" }], {
      cfg,
      label: "test-action",
    });

    const line = await fs.readFile(path.join(confdir, "action-bindings.jsonl"), "utf8");
    assert.match(line, /act_cfg_1/);

    const back = await readActionBindings({ cfg, limit: 10 });
    assert.equal(back.length, 1);
    assert.equal(back[0].actionId, "act_cfg_1");
  });

  it("proof bundles land in the configured dir and stamp their real provenance", async () => {
    const r = await exportProofBundle({ cfg });
    assert.equal(path.dirname(path.dirname(r.path)), confdir);

    const bundle = JSON.parse(await fs.readFile(r.path, "utf8"));
    assert.equal(bundle.confdir, confdir, "bundle must report the dir it describes");
    assert.equal(bundle.mitmEnabled, true, "bundle must report the real mitm state");
  });

  it("loadTimeline reads bindings from the configured dir", async () => {
    await bindActionFlows("act_cfg_tl", [], { cfg, label: "timeline" });
    const timeline = await loadTimeline({ cfg });
    assert.equal(timeline.confdir, confdir);
    assert.ok(
      timeline.bindings.some((b) => b.actionId === "act_cfg_tl"),
      "timeline must see bindings written through the same cfg"
    );
  });
});
