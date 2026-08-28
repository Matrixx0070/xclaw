import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runTelegramPollLoop } from "../src/channels/telegram/poll-loop.mjs";
import {
  detectPollOutage,
  startChannelHealthWatchdog,
  stopChannelHealthWatchdog,
  channelHealthStatus,
} from "../src/channels/health-watchdog.mjs";
import {
  parseSingletonTarget,
  inspectSingletons,
  clearStaleSingletons,
  buildBrowserArgs,
} from "../src/browser/dedicated.mjs";

describe("poll loop liveness signal", () => {
  it("onPollOk fires on every successful getUpdates (incl. empty), not on failures", async () => {
    let polls = 0, ok = 0, errs = 0;
    await runTelegramPollLoop({
      api: async (method) => {
        if (method !== "getUpdates") return {};
        polls += 1;
        if (polls === 2) throw new Error("fetch failed");
        return [];
      },
      // stop as soon as the error has been observed — the backoff sleep
      // resolves immediately once isStopped is true
      isStopped: () => errs >= 1,
      onUpdate: async () => {},
      onPollOk: () => { ok += 1; },
      onError: () => { errs += 1; },
      conf: {},
    });
    assert.equal(polls, 2);
    assert.equal(ok, 1, "success poll signalled");
    assert.equal(errs, 1, "failed poll did NOT signal ok");
  });
});

describe("detectPollOutage", () => {
  const now = Date.parse("2026-08-14T12:00:00Z");
  it("threshold on consecutive failures", () => {
    assert.equal(detectPollOutage({ enabled: true, consecutivePollFails: 8 }, { now }), true);
    assert.equal(detectPollOutage({ enabled: true, consecutivePollFails: 7 }, { now }), false);
  });
  it("stale lastPollOkAt with newer error", () => {
    const st = {
      enabled: true,
      consecutivePollFails: 2,
      lastPollOkAt: "2026-08-14T11:50:00Z",   // 10 min ago
      lastPollErrorAt: "2026-08-14T11:59:00Z",
    };
    assert.equal(detectPollOutage(st, { now }), true);
    assert.equal(detectPollOutage({ ...st, lastPollOkAt: "2026-08-14T11:58:00Z" }, { now }), false, "recent ok = healthy");
    assert.equal(detectPollOutage({ ...st, lastPollErrorAt: "2026-08-14T11:40:00Z" }, { now }), false, "error older than ok = recovered");
  });
  it("disabled channels never alert", () => {
    assert.equal(detectPollOutage({ enabled: false, consecutivePollFails: 99 }, { now }), false);
  });
});

describe("watchdog raises outage alerts (transition-only) + recovery event", () => {
  it("alerts once while in outage; emits recovery on transition out", async () => {
    const { runWatchdogTickOnce } = await import("../src/channels/health-watchdog.mjs");
    const alerts = [];
    const events = [];
    let status = [{
      name: "telegram", enabled: true, running: true, loopAlive: true,
      consecutivePollFails: 10, lastPollOkAt: null,
      lastPollErrorAt: new Date().toISOString(), lastError: "fetch failed",
    }];
    const manager = { status: () => status };
    startChannelHealthWatchdog({}, manager, {
      intervalMs: 3_600_000, // no auto ticks during the test
      alerter: { send: async (a) => alerts.push(a) },
      onEvent: (e) => events.push(e),
    });
    const triggers = () => alerts.filter((a) => a.eventAction !== "resolve");
    const resolves = () => alerts.filter((a) => a.eventAction === "resolve");
    await runWatchdogTickOnce();
    await runWatchdogTickOnce(); // second tick while STILL in outage
    assert.equal(triggers().length, 1, "alert fires on the transition, not every tick");
    assert.equal(alerts[0].key, "channel-outage:telegram");
    assert.equal(alerts[0].severity, "error");
    assert.equal(channelHealthStatus().channels.telegram.outageSince !== null, true);

    // recovery: polls succeed again
    status = [{
      name: "telegram", enabled: true, running: true, loopAlive: true,
      consecutivePollFails: 0, lastPollOkAt: new Date().toISOString(),
      lastPollErrorAt: null, lastError: null,
    }];
    await runWatchdogTickOnce();
    assert.equal(channelHealthStatus().channels.telegram.outageSince, null);
    assert.ok(events.some((e) => e.phase === "recovered" && e.channel === "telegram"));
    // …and the incident is CLOSED. PagerDuty dedups on the key, so an incident
    // left open by a blip swallows the next real outage's page: recovery has to
    // deliver a resolve under the SAME key the trigger used, not just log.
    assert.equal(resolves().length, 1, "recovery resolves the incident");
    assert.equal(resolves()[0].key, "channel-outage:telegram", "same dedup key as the trigger");
    assert.ok(events.some((e) => e.phase === "resolved" && e.key === "channel-outage:telegram"));
    // a NEW outage after recovery alerts again
    status = [{
      name: "telegram", enabled: true, running: true, loopAlive: true,
      consecutivePollFails: 20, lastPollOkAt: null,
      lastPollErrorAt: new Date().toISOString(), lastError: "fetch failed",
    }];
    await runWatchdogTickOnce();
    assert.equal(triggers().length, 2);
    stopChannelHealthWatchdog();
  });
});

describe("watchdog closes the restart-circuit incident when the channel returns", () => {
  it("resolves channel-circuit-open under the same key once the channel is alive", async () => {
    const { runWatchdogTickOnce } = await import("../src/channels/health-watchdog.mjs");
    const alerts = [];
    let status = [{ name: "discord", enabled: true, running: false, loopAlive: false }];
    const manager = {
      status: () => status,
      restart: async () => { throw new Error("boom"); },
    };
    // maxConsecutiveFails:1 + no restart backoff so the circuit opens in two
    // ticks instead of eight minutes.
    startChannelHealthWatchdog(
      { channels: { healthWatchdog: { maxConsecutiveFails: 1, minRestartIntervalMs: 0 } } },
      manager,
      { intervalMs: 3_600_000, alerter: { send: async (a) => alerts.push(a) } }
    );
    await runWatchdogTickOnce(); // restart fails → consecutiveFail = 1
    await runWatchdogTickOnce(); // circuit opens → alert
    const opened = alerts.filter((a) => a.key === "channel-circuit-open:discord");
    assert.equal(opened.length, 1, "giving up on restarts alerts");
    assert.equal(opened[0].eventAction, undefined, "…as a trigger");

    // channel comes back — the incident must CLOSE, or PagerDuty dedups the
    // next circuit-open into this stale one and nobody is paged for it.
    status = [{ name: "discord", enabled: true, running: true, loopAlive: true }];
    await runWatchdogTickOnce();
    const closed = alerts.filter(
      (a) => a.key === "channel-circuit-open:discord" && a.eventAction === "resolve"
    );
    assert.equal(closed.length, 1, "recovery resolves the circuit incident");
    // and only once — the latch is cleared, not re-fired every healthy tick
    await runWatchdogTickOnce();
    assert.equal(alerts.length, 2, "no repeat resolves while healthy");
    stopChannelHealthWatchdog();
  });
});

describe("dedicated browser singleton healing", () => {
  it("parseSingletonTarget handles hostname-pid incl. hyphenated hosts", () => {
    assert.deepEqual(parseSingletonTarget("srv1474168-2525043"), { host: "srv1474168", pid: 2525043 });
    assert.deepEqual(parseSingletonTarget("my-host-name-42"), { host: "my-host-name", pid: 42 });
    assert.equal(parseSingletonTarget("garbage"), null);
  });

  it("stale locks (dead pid on this host) are detected and cleared; live kept", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-browser-"));
    // dead-pid lock (pid 999999999 can't exist)
    fs.symlinkSync(`${os.hostname()}-999999999`, path.join(dir, "SingletonLock"));
    fs.symlinkSync("12345", path.join(dir, "SingletonCookie"));
    let insp = inspectSingletons(dir);
    assert.equal(insp.ownerAlive, false);
    let r = clearStaleSingletons(dir);
    assert.deepEqual(r.kept, []);
    assert.ok(r.cleared.includes("SingletonLock"));
    assert.equal(fs.existsSync(path.join(dir, "SingletonLock")), false);

    // live-pid lock (our own pid) is kept without force
    fs.symlinkSync(`${os.hostname()}-${process.pid}`, path.join(dir, "SingletonLock"));
    insp = inspectSingletons(dir);
    assert.equal(insp.ownerAlive, true);
    r = clearStaleSingletons(dir);
    assert.deepEqual(r.cleared, []);
    assert.ok(r.kept.includes("SingletonLock"));
    // force overrides
    r = clearStaleSingletons(dir, { force: true });
    assert.ok(r.cleared.includes("SingletonLock"));

    // foreign-host lock is never stolen
    fs.symlinkSync(`other-host-1`, path.join(dir, "SingletonLock"));
    insp = inspectSingletons(dir);
    assert.equal(insp.ownerAlive, true, "foreign host treated as live");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("buildBrowserArgs shape", () => {
    const args = buildBrowserArgs({ port: 9224, profileDir: "/p", url: "http://x/", app: true });
    assert.ok(args.includes("--remote-debugging-port=9224"));
    assert.ok(args.includes("--user-data-dir=/p"));
    assert.ok(args.includes("--app=http://x/"));
    const plain = buildBrowserArgs({ port: 1, profileDir: "/p", url: "http://x/", app: false });
    assert.ok(plain.includes("http://x/"));
    assert.ok(!plain.some((a) => a.startsWith("--app=")));
  });
});
