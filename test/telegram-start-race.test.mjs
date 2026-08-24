/**
 * Regression: 2026-08-24 telegram outage + restart storm.
 *  1. A transient getMe failure at gateway boot killed the channel until the
 *     watchdog's next pass — start() now retries retryable getMe errors.
 *  2. The health watchdog's restart and a manual /channels/manage/restart ran
 *     concurrently; interleaved stop/start left TWO poll loops terminating each
 *     other's getUpdates (CONFLICT storm) until a process restart — start() is
 *     now a no-op while a loop is alive, and the channel manager serializes
 *     lifecycle calls per channel.
 * Uses a local mock Bot API server via XCLAW_TELEGRAM_API_BASE.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createTelegramChannel } from "../src/channels/telegram/index.mjs";
import { createChannelManager } from "../src/channels/manager.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createMockBotApi() {
  const state = {
    getMeFailuresLeft: 0,
    getMeHits: 0,
    getUpdatesInFlight: 0,
    maxGetUpdatesInFlight: 0,
    getUpdatesHits: 0,
  };
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
        state.getMeHits += 1;
        if (state.getMeFailuresLeft > 0) {
          state.getMeFailuresLeft -= 1;
          send(502, { ok: false, error_code: 502, description: "Bad Gateway" });
          return;
        }
        send(200, { ok: true, result: { id: 1, is_bot: true, username: "mockbot" } });
        return;
      }
      if (method === "deleteWebhook") {
        send(200, { ok: true, result: true });
        return;
      }
      if (method === "getUpdates") {
        state.getUpdatesHits += 1;
        state.getUpdatesInFlight += 1;
        state.maxGetUpdatesInFlight = Math.max(
          state.maxGetUpdatesInFlight,
          state.getUpdatesInFlight
        );
        let timeout = 0;
        try {
          timeout = Number(JSON.parse(body || "{}").timeout) || 0;
        } catch {
          /* */
        }
        // Long polls linger briefly so overlapping loops actually overlap here.
        await sleep(timeout > 0 ? 120 : 5);
        state.getUpdatesInFlight -= 1;
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

const cfgFor = () => ({
  channels: {
    telegram: {
      enabled: true,
      token: "TEST:token",
      dmPolicy: "open",
      singleWriter: false,
      pollTimeoutSec: 1,
    },
  },
});

describe("telegram start race + boot retry", () => {
  let mock;
  let port;
  let prevBase;

  before(async () => {
    mock = createMockBotApi();
    port = await mock.listen();
    prevBase = process.env.XCLAW_TELEGRAM_API_BASE;
    process.env.XCLAW_TELEGRAM_API_BASE = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (prevBase !== undefined) process.env.XCLAW_TELEGRAM_API_BASE = prevBase;
    else delete process.env.XCLAW_TELEGRAM_API_BASE;
    await mock.close();
  });

  it("start() retries a transient getMe failure instead of dying", async () => {
    const ch = createTelegramChannel(cfgFor());
    mock.state.getMeFailuresLeft = 2;
    mock.state.getMeHits = 0;
    await ch.start();
    assert.equal(mock.state.getMeHits, 3, "two 502s then success");
    assert.equal(ch.status().running, true);
    await ch.stop();
  });

  it("start() fails fast on a non-retryable getMe error (bad token)", async () => {
    const ch = createTelegramChannel(cfgFor());
    const failing = createMockBotApi();
    const p2 = await failing.listen();
    // Point at a mock that always answers 401 Unauthorized
    failing.server.removeAllListeners("request");
    failing.server.on("request", (req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error_code: 401, description: "Unauthorized" }));
    });
    process.env.XCLAW_TELEGRAM_API_BASE = `http://127.0.0.1:${p2}`;
    try {
      await assert.rejects(() => ch.start(), /Unauthorized/);
    } finally {
      process.env.XCLAW_TELEGRAM_API_BASE = `http://127.0.0.1:${port}`;
      await failing.close();
    }
  });

  it("start() is a no-op while the loop is alive (no second poller)", async () => {
    const ch = createTelegramChannel(cfgFor());
    mock.state.getMeFailuresLeft = 0;
    await ch.start();
    const hitsAfterFirst = mock.state.getMeHits;
    await ch.start(); // must not launch a second loop
    assert.equal(mock.state.getMeHits, hitsAfterFirst, "second start skipped getMe");
    mock.state.maxGetUpdatesInFlight = 0;
    await sleep(400);
    assert.ok(
      mock.state.maxGetUpdatesInFlight <= 1,
      `one poller only, saw ${mock.state.maxGetUpdatesInFlight}`
    );
    await ch.stop();
  });

  it("stop() actually stops polling (loop awaited, none left behind)", async () => {
    const ch = createTelegramChannel(cfgFor());
    await ch.start();
    await sleep(150);
    await ch.stop();
    const hitsAtStop = mock.state.getUpdatesHits;
    await sleep(400);
    assert.equal(
      mock.state.getUpdatesHits,
      hitsAtStop,
      "no getUpdates after stop resolved"
    );
    assert.equal(ch.status().running, false);
  });

  it("concurrent restartChannel calls serialize to a single poller", async () => {
    const m = createChannelManager(cfgFor());
    await m.get("telegram").start();
    // The storm shape: two restarts land at once (watchdog tick + manual route).
    const results = await Promise.all([
      m.restartChannel("telegram"),
      m.restartChannel("telegram"),
      m.restartChannel("telegram"),
    ]);
    for (const r of results) assert.equal(r.ok, true);
    mock.state.maxGetUpdatesInFlight = 0;
    await sleep(500);
    assert.ok(
      mock.state.maxGetUpdatesInFlight <= 1,
      `single poller after concurrent restarts, saw ${mock.state.maxGetUpdatesInFlight}`
    );
    assert.equal(m.get("telegram").status().running, true);
    await m.stopAll();
  });
});
