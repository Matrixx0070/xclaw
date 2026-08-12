import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  emptyPolicy,
  loadPolicy,
  savePolicy,
  matchRule,
  evaluateRequestPolicy,
  applyPathRewrite,
  evaluateRequireRules,
  exportProofBundle,
  policyToEnvHints,
  afterBrowserToolTruth,
} from "../src/browser/truth.mjs";
import { createBrowserTools } from "../src/tools/browser-tools.mjs";

describe("Horizon 2 Truth control plane", () => {
  it("matchRule hostContains and pathPrefix", () => {
    const rule = { match: { hostContains: "tracker", pathPrefix: "/pixel" } };
    assert.equal(
      matchRule(rule, { host: "ads.tracker.com", path: "/pixel/1", method: "GET" }),
      true
    );
    assert.equal(
      matchRule(rule, { host: "example.com", path: "/pixel/1", method: "GET" }),
      false
    );
  });

  it("evaluateRequestPolicy blocks and maps", () => {
    const policy = {
      version: 1,
      rules: [
        { id: "b1", action: "block", match: { hostOrPathContains: "evil" } },
        {
          id: "m1",
          action: "map",
          match: { pathPrefix: "/v1/" },
          rewrite: { pathPrefix: "/v2/" },
        },
      ],
    };
    assert.equal(
      evaluateRequestPolicy(policy, { host: "evil.com", path: "/" }).action,
      "block"
    );
    const mapd = evaluateRequestPolicy(policy, {
      host: "api.com",
      path: "/v1/users",
    });
    assert.equal(mapd.action, "map");
    assert.equal(applyPathRewrite("/v1/users", mapd.rule), "/v2/users");
  });

  it("save and load policy.json", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-truth-"));
    process.env.XCLAW_MITM_CONFDIR = tmp;
    // clear env pollution
    delete process.env.XCLAW_MITM_BLOCK;
    delete process.env.XCLAW_MITM_MAP;
    delete process.env.XCLAW_MITM_ALLOWLIST;
    try {
      const policy = {
        version: 1,
        rules: [{ id: "r1", action: "block", match: { hostContains: "x" } }],
      };
      const saved = await savePolicy(policy);
      assert.equal(saved.ok, true);
      const loaded = await loadPolicy();
      assert.ok(loaded.rules.some((r) => r.id === "r1"));
    } finally {
      delete process.env.XCLAW_MITM_CONFDIR;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("policyToEnvHints compiles block and map", () => {
    const hints = policyToEnvHints({
      rules: [
        { action: "block", match: { hostContains: "ads" } },
        {
          action: "map",
          match: { pathPrefix: "/a" },
          rewrite: { pathPrefix: "/b" },
        },
      ],
    });
    assert.ok(hints.XCLAW_MITM_BLOCK.includes("ads"));
    assert.ok(hints.XCLAW_MITM_MAP.includes("/a=>/b"));
  });

  it("evaluateRequireRules reports miss", async () => {
    const policy = {
      rules: [
        {
          id: "need-post",
          action: "require",
          match: { method: "POST", hostContains: "api" },
          expect: { status: 200, minFlows: 1 },
        },
      ],
    };
    const r = await evaluateRequireRules(policy, {
      flows: [{ method: "GET", host: "api.com", status: 200 }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.checked, 1);
  });

  it("exportProofBundle writes sha256 file", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-proof-"));
    process.env.XCLAW_MITM_CONFDIR = tmp;
    try {
      await fs.writeFile(
        path.join(tmp, "flows.jsonl"),
        JSON.stringify({ ts: 1, method: "GET", host: "h", path: "/", status: 200 }) + "\n"
      );
      const r = await exportProofBundle({ limit: 10 });
      assert.equal(r.ok, true);
      assert.ok(r.sha256.length === 64);
      const body = await fs.readFile(r.path, "utf8");
      assert.ok(body.includes("xclaw-truth-proof"));
    } finally {
      delete process.env.XCLAW_MITM_CONFDIR;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("afterBrowserToolTruth no-ops without auto flag", async () => {
    delete process.env.XCLAW_TRUTH_AUTO_ASSERT;
    const r = await afterBrowserToolTruth("browser_snapshot", {
      metadata: { actionId: "act_x" },
    });
    assert.equal(r, null);
  });

  it("tools register mitm_policy and mitm_export", () => {
    const names = createBrowserTools({}).map((t) => t.name);
    assert.ok(names.includes("mitm_policy"));
    assert.ok(names.includes("mitm_export"));
  });
});
