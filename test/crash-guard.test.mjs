/**
 * Crash-loop guard + port readiness (spec §13.4 + §13.5) — backoff tiers
 * 0 / 30s / 5m / refuse-at-10 over a 15-minute window, stale entries
 * filtered, clear() unlinks, exit-hook recording proven in a real child
 * process. waitForPort true against a live listener, false on a closed
 * port within the timeout. Both unadopted by the live gateway.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { applyCrashLoopGuard, waitForPort } from "../src/gateway/crash-guard.mjs";

function seededDir(timestamps) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-crash-guard-"));
  if (timestamps) {
    fs.writeFileSync(path.join(dir, "gateway-crash-history.json"), JSON.stringify(timestamps));
  }
  return dir;
}

describe("crash guard (spec §13.4)", () => {
  it("backoff tiers: 0 fresh, 30s at 4, 5m at 7, refuse at 10; stale entries ignored", () => {
    const now = Date.now();
    const recent = (n) => Array.from({ length: n }, () => now - 1000);
    assert.equal(applyCrashLoopGuard(seededDir(null)).delayMs, 0);
    assert.equal(applyCrashLoopGuard(seededDir(recent(3))).delayMs, 0);
    assert.equal(applyCrashLoopGuard(seededDir(recent(4))).delayMs, 30_000);
    assert.equal(applyCrashLoopGuard(seededDir(recent(7))).delayMs, 300_000);
    assert.throws(
      () => applyCrashLoopGuard(seededDir(recent(10))),
      (err) => err.code === "XCLAW_CRASH_LOOP" && /10 failures in 15m/.test(err.message),
    );
    const stale = Array.from({ length: 10 }, () => now - 16 * 60 * 1000);
    assert.equal(applyCrashLoopGuard(seededDir(stale)).delayMs, 0);
  });

  it("clear() unlinks the history file", () => {
    const dir = seededDir([Date.now() - 1000]);
    const file = path.join(dir, "gateway-crash-history.json");
    const guard = applyCrashLoopGuard(dir);
    assert.equal(fs.existsSync(file), true);
    guard.clear();
    assert.equal(fs.existsSync(file), false);
  });

  it("every process exit records a crash timestamp (real child process)", () => {
    const dir = seededDir(null);
    const file = path.join(dir, "gateway-crash-history.json");
    const script = `
      import { applyCrashLoopGuard } from ${JSON.stringify(new URL("../src/gateway/crash-guard.mjs", import.meta.url).href)};
      applyCrashLoopGuard(${JSON.stringify(dir)});
      process.exit(0);
    `;
    execFileSync(process.execPath, ["--input-type=module", "-e", script]);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).length, 1);
    execFileSync(process.execPath, ["--input-type=module", "-e", script]);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).length, 2);
  });
});

describe("port readiness (spec §13.5)", () => {
  it("true against a live listener; false on a closed port within the timeout", async () => {
    const server = net.createServer(() => {});
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const livePort = server.address().port;
    try {
      assert.equal(await waitForPort("127.0.0.1", livePort, 2000), true);
    } finally {
      server.close();
    }
    const dead = net.createServer(() => {});
    await new Promise((r) => dead.listen(0, "127.0.0.1", r));
    const deadPort = dead.address().port;
    await new Promise((r) => dead.close(r));
    const started = Date.now();
    assert.equal(await waitForPort("127.0.0.1", deadPort, 600), false);
    assert.ok(Date.now() - started >= 600, "must poll until the deadline");
  });

  it("guard adopted only inside the flag-gated supervised path; waitForPort stays unwired", () => {
    const gw = fs.readFileSync(new URL("../src/gateway/index.mjs", import.meta.url), "utf8");
    const supervised = gw.slice(
      gw.indexOf("async function startGatewaySupervised"),
      gw.indexOf("export async function startGateway"),
    );
    assert.match(supervised, /applyCrashLoopGuard\(stateRoot\)/);
    assert.match(supervised, /guard\.clear\(\)/);
    assert.equal(gw.includes("waitForPort"), false);
  });
});
