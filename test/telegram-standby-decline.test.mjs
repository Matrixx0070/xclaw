/**
 * Regression: a declined start looked exactly like a successful one.
 *
 *  1. stop() fired a getUpdates "interrupter" whenever transport was poll —
 *     including on an instance that never owned a loop. getUpdates on a
 *     shared token 409-terminates whichever process IS polling, so a
 *     single-writer standby killed the real writer's poll every time its
 *     watchdog restarted it.
 *  2. startInner() returned undefined when it DECLINED to start (writer lock
 *     held elsewhere, webhookUrl missing), so restartChannel reported ok and
 *     the watchdog reset consecutiveFail on every pass — its circuit-open
 *     "manual intervention needed" alert was unreachable and it restart-looped
 *     a permanently dead channel in silence.
 *
 * The two compound: the standby's silent restart loop hammered the real
 * writer once per tick, forever, with no alert.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createTelegramChannel } from "../src/channels/telegram/index.mjs";
import { createChannelManager } from "../src/channels/manager.mjs";
import {
  startChannelHealthWatchdog,
  stopChannelHealthWatchdog,
  runWatchdogTickOnce,
  channelHealthStatus,
} from "../src/channels/health-watchdog.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createMockBotApi() {
  const state = { getUpdatesHits: 0, zeroTimeoutHits: 0 };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const method = req.url.split("/").pop();
      const send = (code, obj) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      if (method === "getMe") {
        send(200, { ok: true, result: { id: 1, is_bot: true, username: "mockbot" } });
        return;
      }
      if (method === "getUpdates") {
        state.getUpdatesHits += 1;
        let timeout = 0;
        try {
          timeout = Number(JSON.parse(body || "{}").timeout) || 0;
        } catch {
          /* */
        }
        // The interrupter is the only getUpdates that asks for timeout 0.
        if (timeout === 0) state.zeroTimeoutHits += 1;
        await sleep(timeout > 0 ? 60 : 2);
        send(200, { ok: true, result: [] });
        return;
      }
      send(200, { ok: true, result: {} });
    });
  });
  return {
    state,
    server,
    async listen() {
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      return server.address().port;
    },
    async close() {
      await new Promise((r) => server.close(r));
    },
  };
}

describe("telegram declined starts are distinguishable from successful ones", () => {
  let mock;
  let port;
  let prevBase;
  let prevHookUrl;
  let tmpDir;
  let holder;
  let lockPath;

  const cfgFor = (extra = {}) => ({
    channels: {
      telegram: {
        enabled: true,
        token: "TEST:token",
        dmPolicy: "open",
        pollTimeoutSec: 1,
        singleWriter: false,
        ...extra,
      },
    },
  });

  before(async () => {
    mock = createMockBotApi();
    port = await mock.listen();
    prevBase = process.env.XCLAW_TELEGRAM_API_BASE;
    prevHookUrl = process.env.XCLAW_TELEGRAM_WEBHOOK_URL;
    process.env.XCLAW_TELEGRAM_API_BASE = `http://127.0.0.1:${port}`;
    delete process.env.XCLAW_TELEGRAM_WEBHOOK_URL;

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-writer-lock-"));
    lockPath = path.join(tmpDir, "telegram-writer.lock");
    // A lock held by a LIVE process that is not us — the only shape
    // acquireTelegramWriterLock refuses (a dead or stale holder is evicted).
    holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 120000)"], {
      stdio: "ignore",
    });
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: holder.pid, at: new Date().toISOString(), host: os.hostname() })
    );
  });

  after(async () => {
    if (prevBase !== undefined) process.env.XCLAW_TELEGRAM_API_BASE = prevBase;
    else delete process.env.XCLAW_TELEGRAM_API_BASE;
    if (prevHookUrl !== undefined) process.env.XCLAW_TELEGRAM_WEBHOOK_URL = prevHookUrl;
    holder?.kill("SIGKILL");
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await mock.close();
  });

  it("a standby stop() does not interrupt the owning process's poll", async () => {
    const ch = createTelegramChannel(cfgFor({ singleWriter: true, writerLockPath: lockPath }));
    const res = await ch.start();
    assert.equal(res.started, false, "start declined behind the held lock");
    assert.equal(res.standby, true);
    assert.equal(ch.status().standby, true);
    assert.equal(ch.status().running, false);

    const before = mock.state.getUpdatesHits;
    await ch.stop();
    assert.equal(
      mock.state.getUpdatesHits,
      before,
      "standby must issue NO getUpdates — one would 409-kill the real writer"
    );
  });

  it("an owning stop() still interrupts its own long poll", async () => {
    const ch = createTelegramChannel(cfgFor());
    await ch.start();
    await sleep(120);
    const before = mock.state.zeroTimeoutHits;
    await ch.stop();
    assert.equal(
      mock.state.zeroTimeoutHits,
      before + 1,
      "the interrupter must still fire for a loop we own"
    );
  });

  it("restartChannel surfaces a standby decline instead of reporting ok", async () => {
    const m = createChannelManager(cfgFor({ singleWriter: true, writerLockPath: lockPath }));
    const r = await m.restartChannel("telegram");
    assert.equal(r.ok, false);
    assert.equal(r.standby, true);
    assert.match(r.reason, /writer_lock/);
  });

  it("restartChannel surfaces a missing webhook url as a failed start", async () => {
    const m = createChannelManager(cfgFor({ transport: "webhook" }));
    const r = await m.restartChannel("telegram");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "webhook_url_missing");
    assert.equal(r.standby, false, "a misconfiguration is not standby");
  });
});

describe("watchdog acts on declined restarts", () => {
  const alerts = [];
  const alerter = {
    async send(a) {
      alerts.push(a);
    },
  };

  after(() => stopChannelHealthWatchdog());

  it("counts a declined start as a failed restart and opens the circuit", async () => {
    alerts.length = 0;
    let restartCalls = 0;
    const manager = {
      status: () => [{ name: "declines", enabled: true, running: false, loopAlive: false }],
      restart: async () => {
        restartCalls += 1;
        return { ok: false, name: "declines", reason: "webhook_url_missing", standby: false };
      },
    };
    startChannelHealthWatchdog(
      {
        channels: {
          healthWatchdog: { enabled: true, minRestartIntervalMs: 0, maxConsecutiveFails: 2 },
        },
      },
      manager,
      { intervalMs: 60_000, alerter }
    );

    await runWatchdogTickOnce();
    await runWatchdogTickOnce();
    assert.equal(restartCalls, 2, "it retries up to the fail ceiling");
    assert.equal(channelHealthStatus().channels.declines.consecutiveFail, 2);

    // Third pass: circuit open, operator told. Previously consecutiveFail was
    // reset to 0 on every declined restart, so this alert never fired.
    await runWatchdogTickOnce();
    assert.equal(restartCalls, 2, "no further restarts once the circuit is open");
    const open = alerts.find((a) => a.key === "channel-circuit-open:declines");
    assert.ok(open, "circuit-open alert must reach the operator");
    assert.match(open.title, /channel dead/);
    stopChannelHealthWatchdog();
  });

  it("never restarts a single-writer standby", async () => {
    alerts.length = 0;
    let restartCalls = 0;
    const manager = {
      status: () => [
        { name: "standby", enabled: true, running: false, loopAlive: false, standby: true },
      ],
      restart: async () => {
        restartCalls += 1;
        return { ok: true, name: "standby" };
      },
    };
    startChannelHealthWatchdog(
      {
        channels: {
          healthWatchdog: { enabled: true, minRestartIntervalMs: 0, maxConsecutiveFails: 2 },
        },
      },
      manager,
      { intervalMs: 60_000, alerter }
    );

    await runWatchdogTickOnce();
    await runWatchdogTickOnce();
    await runWatchdogTickOnce();
    assert.equal(restartCalls, 0, "standby is running:false BY DESIGN — restarting cannot help");
    assert.equal(alerts.length, 0, "and it is not an outage to alert on");
    stopChannelHealthWatchdog();
  });
});
