/**
 * `xclaw doctor` must report the channel watchdog's REAL state.
 *
 * `/gateway/info` exposes an `ops` block so the out-of-process doctor can see
 * gateway-local state; it shipped with three fields and only two were ever
 * consumed. `channelWatchdogRunning` was written and never read, so on the live
 * box — gateway up, `/gateway/info` reporting `channelWatchdogRunning: true` —
 * doctor printed, in the same run:
 *
 *   [OK  ] computer.watchdog: active every 30000ms (in gateway)
 *   [OK  ] eval.cron: registered (in gateway)
 *   [OK  ] channels.health: channel watchdog idle (start gateway to enable)
 *
 * The severity mattered more than the wording. The probe branched on its own
 * process's `running`, which is false in the CLI by construction, so it never
 * reached `channels` — meaning a poll outage or a latched-open restart circuit
 * could not be surfaced by the CLI at all. Both conditions page the operator
 * from `health-watchdog.mjs` (`channel-outage:*`, `channel-circuit-open:*`), so
 * reporting "ok" contradicted an alert xclaw itself had already sent.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { projectChannelHealth, summarizeChannelHealth } from "../src/channels/health-report.mjs";
import { tryHandleOpsRoute } from "../src/gateway/routes/ops.mjs";

const clean = {
  running: true,
  startedAt: "2026-08-28T00:00:00.000Z",
  lastTickAt: "2026-08-28T01:00:00.000Z",
  lastError: null,
  channels: { telegram: { restarts: 0, consecutiveFail: 0, outageSince: null, circuitAlerted: false } },
};

describe("projectChannelHealth publishes an allow-list", () => {
  it("keeps the operator-relevant fields", () => {
    const out = projectChannelHealth(clean);
    assert.equal(out.running, true);
    assert.equal(out.lastTickAt, clean.lastTickAt);
    assert.deepEqual(Object.keys(out.channels), ["telegram"]);
    for (const f of ["restarts", "consecutiveFail", "lastError", "lastOkAt", "lastRestartAt", "outageSince", "circuitAlerted"]) {
      assert.ok(f in out.channels.telegram, `${f} must be relayed`);
    }
  });

  it("does NOT relay a field the watchdog adds later", () => {
    // channelState is an internal map. A route must not start publishing new
    // fields the moment someone adds one to it.
    const out = projectChannelHealth({
      running: true,
      channels: { telegram: { restarts: 0, botToken: "SHOULD-NOT-LEAK", sessionCookie: "nope" } },
    });
    assert.equal("botToken" in out.channels.telegram, false);
    assert.equal("sessionCookie" in out.channels.telegram, false);
    assert.equal(JSON.stringify(out).includes("SHOULD-NOT-LEAK"), false);
  });

  it("returns null rather than a fake shape when there is no status", () => {
    assert.equal(projectChannelHealth(null), null);
    assert.equal(projectChannelHealth(undefined), null);
  });
});

describe("/gateway/info relays the diagnosis, not just a boolean", () => {
  it("exposes ops.channelWatchdog so the out-of-process doctor can escalate", async () => {
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
      json: (_res, _code, payload) => { body = payload; },
      webchatEnabled: true,
      channelManager: { status: () => [] },
      XCLAW_VERSION: "0.0.0-test",
      XCLAW_PHASE: 0,
    });
    assert.equal(handled, true);
    // The boolean stays — it shipped on a public route and something may read
    // it — but the detail is what makes an outage reportable off-process.
    assert.equal(typeof body.ops.channelWatchdogRunning, "boolean");
    assert.notEqual(body.ops.channelWatchdog, undefined, "the relay is not wired");
    assert.ok("channels" in body.ops.channelWatchdog, "relayed shape is unusable");
    assert.equal(body.ops.channelWatchdog.running, body.ops.channelWatchdogRunning);
  });
});

describe("summarizeChannelHealth consults the running gateway", () => {
  it("still says idle when nothing is running anywhere", () => {
    const s = summarizeChannelHealth({ running: false, channels: {} }, null);
    assert.equal(s.severity, "ok");
    assert.match(s.message, /idle \(start gateway to enable\)/);
  });

  it("does NOT claim idle when the gateway relays a running watchdog", () => {
    // The exact live defect: local running=false, gateway running=true.
    const s = summarizeChannelHealth({ running: false, channels: {} }, { channelWatchdog: clean });
    assert.doesNotMatch(s.message, /idle/);
    assert.match(s.message, /in gateway/);
    assert.equal(s.source, "gateway");
  });

  it("reports an older gateway that relays only the boolean", () => {
    const s = summarizeChannelHealth({ running: false, channels: {} }, { channelWatchdogRunning: true });
    assert.equal(s.severity, "ok");
    assert.doesNotMatch(s.message, /idle/);
    assert.match(s.message, /no per-channel detail relayed/);
  });

  it("prefers its own process when the watchdog is local", () => {
    const s = summarizeChannelHealth(clean, { channelWatchdog: { running: true, channels: {} } });
    assert.equal(s.source, "in-process");
    assert.doesNotMatch(s.message, /in gateway/);
  });
});

describe("summarizeChannelHealth escalates what the watchdog already paged for", () => {
  it("warns on a poll outage relayed from the gateway", () => {
    const s = summarizeChannelHealth({ running: false, channels: {} }, {
      channelWatchdog: {
        running: true,
        channels: { telegram: { restarts: 0, outageSince: "2026-08-28T02:00:00.000Z", circuitAlerted: false } },
      },
    });
    assert.equal(s.severity, "warn", "an outage the operator was paged about must not read ok");
    assert.match(s.message, /telegram/);
    assert.match(s.message, /2026-08-28T02:00:00\.000Z/);
  });

  it("errors on a latched-open restart circuit", () => {
    const s = summarizeChannelHealth({ running: false, channels: {} }, {
      channelWatchdog: {
        running: true,
        channels: {
          telegram: { restarts: 5, consecutiveFail: 5, circuitAlerted: true, lastError: "telegram: circuit open after 5 fails" },
        },
      },
    });
    assert.equal(s.severity, "error", "the watchdog gave up restarting — doctor must say so");
    assert.match(s.message, /circuit OPEN/);
    assert.match(s.message, /5 failed restarts/);
    assert.match(s.message, /Manual intervention needed/);
  });

  it("an open circuit outranks an outage on another channel", () => {
    const s = summarizeChannelHealth({ running: false, channels: {} }, {
      channelWatchdog: {
        running: true,
        channels: {
          slack: { outageSince: "2026-08-28T02:00:00.000Z" },
          telegram: { circuitAlerted: true, consecutiveFail: 3 },
        },
      },
    });
    assert.equal(s.severity, "error");
    assert.match(s.message, /telegram/);
  });

  it("warns on a watchdog-level tick error", () => {
    const s = summarizeChannelHealth({ ...clean, lastError: "tick error: boom" }, null);
    assert.equal(s.severity, "warn");
    assert.match(s.message, /tick error: boom/);
  });

  it("stays ok for a healthy relayed watchdog", () => {
    const s = summarizeChannelHealth({ running: false, channels: {} }, { channelWatchdog: clean });
    assert.equal(s.severity, "ok");
    assert.match(s.message, /telegram:restarts=0/);
  });
});
