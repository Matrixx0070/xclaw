import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  executeBash,
  normalizeBashTimeoutSeconds,
} from "../src/computer/modules/bash-tool.mjs";

describe("xclaw_bash codes", () => {
  it("normalizes ms to seconds", () => {
    assert.equal(normalizeBashTimeoutSeconds(30000), 30);
    assert.equal(normalizeBashTimeoutSeconds(5), 5);
    assert.equal(normalizeBashTimeoutSeconds(180000), 120); // 180s ms → clamp 120
    assert.ok(normalizeBashTimeoutSeconds(9999) < 15); // 9999ms → ~10s
  });

  it("empty command code", async () => {
    const r = await executeBash({ command: "  " });
    assert.equal(r.code, "BASH_EMPTY_COMMAND");
  });

  it("success code", async () => {
    const r = await executeBash({ command: "echo hi", timeout: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.code, "BASH_OK");
    assert.match(r.stdout, /hi/);
  });

  it("nonzero exit code", async () => {
    const r = await executeBash({ command: "exit 7", timeout: 10 });
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, 7);
    assert.equal(r.code, "BASH_EXIT_NONZERO");
  });

  it("timeout code", async () => {
    const r = await executeBash({ command: "sleep 5", timeout: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.timedOut, true);
    assert.equal(r.code, "BASH_TIMEOUT");
  });

  it("abort signal", async () => {
    const ac = new AbortController();
    const p = executeBash({ command: "sleep 30", timeout: 60 }, { signal: ac.signal });
    setTimeout(() => ac.abort(), 100);
    const r = await p;
    assert.equal(r.ok, false);
    assert.equal(r.interrupted, true);
    assert.equal(r.code, "BASH_ABORTED");
  });

  it("background started code", async () => {
    const r = await executeBash({ command: "sleep 30", background: true });
    assert.equal(r.ok, true);
    assert.equal(r.code, "BASH_BG_STARTED");
    assert.ok(r.pid);
    assert.ok(r.logFile);
    await executeBash({ command: `kill ${r.pid} 2>/dev/null; kill -9 ${r.pid} 2>/dev/null; true`, timeout: 5 });
  });

  it("output truncated code", async () => {
    // ~2.2MB of 'x' — over the 2_000_000 char keep limit
    const r = await executeBash({
      command: "python3 -c 'print(\"x\"*2200000)'",
      timeout: 30,
    });
    assert.equal(r.ok, true);
    assert.equal(r.outputTruncated, true);
    assert.equal(r.code, "BASH_OUTPUT_TRUNCATED");
    assert.ok(r.stdout.length <= 2_000_000);
    assert.match(r.stderr, /BASH_OUTPUT_TRUNCATED/);
  });
});
