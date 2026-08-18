/**
 * Live autonomy harness is gated on API key (exit 2 when missing).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import {
  hasLiveApiKey,
  isLiveSkipExitCode,
} from "../src/eval/live-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("autonomy harness live gate", () => {
  it("hasLiveApiKey rejects empty/whitespace keys", () => {
    assert.equal(hasLiveApiKey({}), false);
    assert.equal(hasLiveApiKey({ XAI_API_KEY: "" }), false);
    assert.equal(hasLiveApiKey({ XAI_API_KEY: "   " }), false);
    assert.equal(hasLiveApiKey({ XAI_API_KEY: "xai-test" }), true);
  });

  it("isLiveSkipExitCode treats 2 as intentional skip", () => {
    assert.equal(isLiveSkipExitCode(2), true);
    assert.equal(isLiveSkipExitCode(1), false);
  });

  it("live script exits 2 without API key", () => {
    const env = { ...process.env };
    for (const k of ["XAI_API_KEY", "XCLAW_API_KEY", "GROK_API_KEY", "OPENAI_API_KEY"]) {
      delete env[k];
    }
    const r = spawnSync(
      process.execPath,
      [path.join(root, "scripts/autonomy-harness-live.mjs")],
      { cwd: root, env, encoding: "utf8" }
    );
    assert.equal(r.status, 2, r.stderr || r.stdout);
    assert.equal(isLiveSkipExitCode(r.status), true);
    assert.match(r.stderr || "", /SKIP|no API key/i);
  });

  it("live script exits 2 with empty API key", () => {
    const env = { ...process.env, XAI_API_KEY: "  ", XCLAW_API_KEY: "" };
    delete env.GROK_API_KEY;
    delete env.OPENAI_API_KEY;
    const r = spawnSync(
      process.execPath,
      [path.join(root, "scripts/autonomy-harness-live.mjs")],
      { cwd: root, env, encoding: "utf8" }
    );
    assert.equal(r.status, 2, r.stderr || r.stdout);
  });

  it("dispatcher offline path exists", () => {
    assert.ok(fs.existsSync(path.join(root, "scripts/autonomy-harness-offline.mjs")));
    assert.ok(fs.existsSync(path.join(root, "scripts/autonomy-harness.mjs")));
  });

  it("offline still loads a4 cases", async () => {
    const { loadCases } = await import("../src/eval/runner.mjs");
    const cases = await loadCases({ tag: "autonomy" });
    assert.ok(cases.some((c) => String(c.id).startsWith("a4-")));
  });
});
