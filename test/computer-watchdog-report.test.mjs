/**
 * `xclaw doctor` must not print its own zeros as a measurement.
 *
 * The computer-server watchdog runs INSIDE the gateway. `xclaw doctor` runs out
 * of process, where `watchdogStatus()` returns the module's untouched initial
 * state — `{ active: false, restartCount: 0, lastCheckAt: null, lastError: null,
 * consecutiveFail: 0 }`. The CLI rendered that object directly, so a live run
 * printed TWO rows under one key:
 *
 *   [OK  ] computer.watchdog: active every 30000ms (in gateway)
 *   [OK  ] computer.watchdog: checks ok restarts=0 last=—
 *
 * The second is fiction. `restarts=0 last=—` was never an observation of a
 * healthy watchdog; it was the CLI reading counters it had never incremented.
 * A gateway watchdog crash-looping the computer server — 40 restarts, a live
 * `lastError`, `consecutiveFail` climbing — produced that byte-identical
 * "checks ok" row, because `/gateway/info` relayed only the boolean
 * `computerWatchdogActive` and the counters could not cross the process
 * boundary at all.
 *
 * These tests pin the relay (so the diagnosis can travel) and the summary (so
 * severity comes from whichever view is real). They also pin the trap the
 * channel twin hit: a relayed `active: false` must not advise "start gateway",
 * because a relayed value exists only because a gateway ANSWERED.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  projectComputerWatchdog,
  summarizeComputerWatchdog,
} from "../src/computer/watchdog-report.mjs";
import { tryHandleOpsRoute } from "../src/gateway/routes/ops.mjs";

/** What the CLI's own module returns, always. The trap. */
const cliZeros = {
  active: false,
  restartCount: 0,
  lastRestartAt: null,
  lastCheckAt: null,
  lastError: null,
  consecutiveFail: 0,
};

const liveHealthy = {
  active: true,
  restartCount: 2,
  lastRestartAt: "2026-08-28T01:00:00.000Z",
  lastCheckAt: "2026-08-28T02:00:00.000Z",
  lastError: null,
  consecutiveFail: 0,
};

describe("projectComputerWatchdog publishes an allow-list", () => {
  it("relays every operator-relevant field", () => {
    const out = projectComputerWatchdog(liveHealthy);
    for (const f of [
      "active",
      "restartCount",
      "lastRestartAt",
      "lastCheckAt",
      "lastError",
      "consecutiveFail",
    ]) {
      assert.ok(f in out, `${f} must be relayed`);
    }
    assert.equal(out.restartCount, 2);
    assert.equal(out.lastCheckAt, liveHealthy.lastCheckAt);
  });

  it("does NOT relay a field the watchdog adds later", () => {
    const out = projectComputerWatchdog({
      active: true,
      restartCount: 0,
      spawnArgs: ["--token", "SHOULD-NOT-LEAK"],
      childEnv: { XCLAW_API_KEY: "nope" },
    });
    assert.equal("spawnArgs" in out, false);
    assert.equal("childEnv" in out, false);
    assert.equal(JSON.stringify(out).includes("SHOULD-NOT-LEAK"), false);
  });

  it("returns null rather than a fake shape when there is no status", () => {
    assert.equal(projectComputerWatchdog(null), null);
    assert.equal(projectComputerWatchdog(undefined), null);
  });
});

describe("/gateway/info relays the diagnosis, not just a boolean", () => {
  it("exposes ops.computerWatchdog so the out-of-process doctor can escalate", async () => {
    let body = null;
    const handled = await tryHandleOpsRoute({
      p: "/gateway/info",
      method: "GET",
      req: { headers: {} },
      res: {},
      url: new URL("http://local/gateway/info"),
      cfg: {
        gateway: { host: "127.0.0.1", port: 18790, token: "t" },
        computer: { host: "127.0.0.1", port: 4243 },
        agent: { model: "m", maxTurns: 5 },
        paths: { configFile: "/tmp/x.json" },
      },
      json: (_res, _code, payload) => {
        body = payload;
      },
      webchatEnabled: true,
      channelManager: { status: () => [] },
      XCLAW_VERSION: "0.0.0-test",
      XCLAW_PHASE: 0,
    });
    assert.equal(handled, true);
    // The boolean stays — it shipped on a public route — but restartCount /
    // lastError / consecutiveFail are what make a crash-loop reportable
    // off-process, and they had no channel to travel through at all.
    assert.equal(typeof body.ops.computerWatchdogActive, "boolean");
    assert.notEqual(body.ops.computerWatchdog, undefined, "the relay is not wired");
    assert.ok("restartCount" in body.ops.computerWatchdog, "relayed shape is unusable");
    assert.ok("consecutiveFail" in body.ops.computerWatchdog, "relayed shape is unusable");
    assert.equal(body.ops.computerWatchdog.active, body.ops.computerWatchdogActive);
  });
});

describe("summarizeComputerWatchdog never reports the CLI's own zeros", () => {
  it("does not print restarts=0 when nothing was measured", () => {
    // The exact live defect: local zeros, gateway down. "restarts=0" here would
    // be an invented reading of a watchdog that has never run in this process.
    const s = summarizeComputerWatchdog(cliZeros, null, false);
    assert.equal(s.severity, "warn");
    assert.match(s.message, /start gateway/);
    assert.equal(/restarts=/.test(s.message), false, "reported counters it never took");
  });

  it("reports the GATEWAY's numbers when they are relayed", () => {
    const s = summarizeComputerWatchdog(cliZeros, { computerWatchdog: liveHealthy });
    assert.equal(s.severity, "ok");
    assert.match(s.message, /restarts=2/);
    assert.match(s.message, /lastCheck=2026-08-28T02:00:00\.000Z/);
    assert.match(s.message, /\(in gateway\)/);
    assert.equal(s.source, "gateway");
  });

  it("says the detail is missing on a gateway too old to relay it", () => {
    const s = summarizeComputerWatchdog(cliZeros, { computerWatchdogActive: true });
    assert.equal(s.severity, "ok");
    assert.match(s.message, /no restart detail relayed/);
    assert.equal(/restarts=0/.test(s.message), false);
  });

  it("stays ok and silent when the watchdog is switched off by config", () => {
    const s = summarizeComputerWatchdog(cliZeros, null, false, { enabled: false });
    assert.equal(s.severity, "ok");
    assert.equal(s.message, "disabled");
  });
});

describe("summarizeComputerWatchdog escalates what the operator cannot see", () => {
  it("errors when the watchdog is NOT running inside a live gateway", () => {
    // A gateway that answered is not a gateway to start. Nothing restarts the
    // computer server while this is true.
    const s = summarizeComputerWatchdog(
      cliZeros,
      { computerWatchdogActive: false, computerWatchdog: { ...cliZeros } },
      true
    );
    assert.equal(s.severity, "error");
    assert.match(s.message, /NOT running inside a live gateway/);
    assert.equal(/start gateway\b/.test(s.message), false, "told the operator to start a live gateway");
  });

  it("warns rather than passing when a live gateway relays nothing", () => {
    const s = summarizeComputerWatchdog(cliZeros, {}, true);
    assert.equal(s.severity, "warn", "unknown is not healthy");
    assert.match(s.message, /reported no computer watchdog state/);
  });

  it("errors on repeated restart failures — the incident the watchdog exists for", () => {
    const s = summarizeComputerWatchdog(cliZeros, {
      computerWatchdog: {
        active: true,
        restartCount: 40,
        consecutiveFail: 5,
        lastError: "spawn ENOENT",
        lastCheckAt: "2026-08-28T02:00:00.000Z",
      },
    });
    assert.equal(s.severity, "error", "a crash-looping watchdog used to print checks ok");
    assert.match(s.message, /cannot restart the computer server/);
    assert.match(s.message, /5 consecutive failures/);
    assert.match(s.message, /spawn ENOENT/);
  });

  it("warns on a single failed check without condemning the watchdog", () => {
    const s = summarizeComputerWatchdog(cliZeros, {
      computerWatchdog: { active: true, restartCount: 1, consecutiveFail: 1, lastError: "ECONNREFUSED" },
    });
    assert.equal(s.severity, "warn");
    assert.match(s.message, /last check failed: ECONNREFUSED/);
    assert.match(s.message, /restarts=1/);
  });

  it("prefers the in-process view when the watchdog really is local", () => {
    // The gateway process itself: no "(in gateway)" suffix, no relay involved.
    const s = summarizeComputerWatchdog(liveHealthy, null, false);
    assert.equal(s.severity, "ok");
    assert.equal(s.source, "in-process");
    assert.equal(/\(in gateway\)/.test(s.message), false);
    assert.match(s.message, /restarts=2/);
  });
});
