import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  executeBash,
  normalizeBashTimeoutSeconds,
  listBackgroundBash,
  killBackgroundBash,
} from "../src/computer/modules/bash-tool.mjs";

describe("xclaw_bash codes", () => {
  it("python kernel pool registers PIDs for stop-all", () => {
    const src = fs.readFileSync(new URL("../src/tools/python-tools.mjs", import.meta.url), "utf8");
    assert.match(src, /registerBackgroundPid/);
    assert.match(src, /python-kernel-pool/);
  });

  it("managed Chrome and mitm register PIDs for stop-all", () => {
    const chrome = fs.readFileSync(
      new URL("../src/computer/chrome-session.mjs", import.meta.url),
      "utf8"
    );
    const mitm = fs.readFileSync(
      new URL("../src/browser/mitm.mjs", import.meta.url),
      "utf8"
    );
    assert.match(chrome, /registerBackgroundPid/);
    assert.match(chrome, /chrome-managed/);
    assert.match(mitm, /registerBackgroundPid/);
    assert.match(mitm, /mitmproxy/);
  });

  it("computer-server and ollama-serve register PIDs for stop-all", () => {
    const mgr = fs.readFileSync(
      new URL("../src/computer/manager.mjs", import.meta.url),
      "utf8"
    );
    const ollama = fs.readFileSync(
      new URL("../src/providers/ollama-install.mjs", import.meta.url),
      "utf8"
    );
    assert.match(mgr, /registerBackgroundPid/);
    assert.match(mgr, /computer-server/);
    assert.match(ollama, /registerBackgroundPid/);
    assert.match(ollama, /ollama-serve/);
  });

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
    const listed = listBackgroundBash().some((j) => j.pid === r.pid);
    assert.equal(listed, true);
    assert.equal(listBackgroundBash().find((j) => j.pid === r.pid)?.kind, "bash");
    const k = killBackgroundBash();
    assert.ok(k.killed.includes(r.pid) || !listBackgroundBash().some((j) => j.pid === r.pid));
    assert.equal(listBackgroundBash().some((j) => j.pid === r.pid), false);
  });

  it("background command that exits immediately is not BASH_BG_STARTED", async () => {
    const r = await executeBash({ command: "exit 1", background: true });
    assert.equal(r.ok, false);
    assert.ok(
      r.code === "BASH_BG_DEAD" || r.code === "BASH_BG_SPAWN_FAILED",
      r.code
    );
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
