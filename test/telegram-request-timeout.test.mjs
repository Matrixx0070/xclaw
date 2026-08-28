/**
 * Watchdog-blindness fix (2026-08-28). Node's `fetch` has no request
 * timeout, so a half-open socket — the shape a NAT drop or a dead route
 * produces, distinct from a reset, which errors immediately — parked
 * api()'s caller forever. On `getUpdates` that is worse than a visible
 * outage: the poll loop is suspended *inside* the request, so it stamps
 * neither `lastPollOkAt` nor `lastPollErrorAt`, `consecutivePollFails`
 * never increments, and `loopAlive` stays true. `detectPollOutage`'s two
 * arms (`fails >= 8`, or `errAt > okAt`) can only fire on an *emitted*
 * error, and a hang emits none — so the channel watchdog reads a wedged
 * poller as healthy and never restarts it.
 *
 * The fix bounds every request with `AbortSignal.timeout()`, budgeted by
 * `telegramRequestTimeoutMs()` off the request's own long-poll window
 * (`body.timeout`) rather than a method-name list — any future long-poll
 * method gets the right budget for free. An abort converts the silent
 * hang into the TIMEOUT|retryable error `classifyTelegramError` already
 * recognized (its first branch, unmodified) — exactly what feeds
 * `lastPollErrorAt` / `consecutivePollFails`, re-enabling the existing
 * machinery instead of adding a parallel one.
 *
 * Deliberately NOT covered here: the five media-upload fetches in
 * photo-out.mjs / voice-out.mjs stay unbounded — a large upload on a slow
 * link is legitimately slow, and a wrong cap would turn a slow success
 * into a regression (see CHANGELOG).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import { after, before, describe, it } from "node:test";
import { createTelegramChannel } from "../src/channels/telegram/index.mjs";
import { classifyTelegramError, telegramRequestTimeoutMs } from "../src/channels/telegram/errors.mjs";

const FAKE_TOKEN = "0000:FAKE-not-a-real-telegram-token-abcdef";

describe("telegramRequestTimeoutMs (pure)", () => {
  it("defaults to the 30s base with no body", () => {
    assert.equal(telegramRequestTimeoutMs("getMe", undefined), 30_000);
  });

  it("defaults to the 30s base when the body carries no timeout field", () => {
    assert.equal(telegramRequestTimeoutMs("sendMessage", { chat_id: 1, text: "hi" }), 30_000);
  });

  it("adds the 15s margin on top of a long-poll window", () => {
    assert.equal(telegramRequestTimeoutMs("getUpdates", { timeout: 30 }), 45_000);
  });

  it("is keyed on body.timeout, not the method name — any method gets the long-poll budget", () => {
    assert.equal(telegramRequestTimeoutMs("someFutureLongPollMethod", { timeout: 10 }), 25_000);
  });

  it("falls back to the base on timeout:0 (a short-poll request)", () => {
    assert.equal(telegramRequestTimeoutMs("getUpdates", { timeout: 0 }), 30_000);
  });

  it("falls back to the base on a negative or non-numeric timeout", () => {
    assert.equal(telegramRequestTimeoutMs("getUpdates", { timeout: -5 }), 30_000);
    assert.equal(telegramRequestTimeoutMs("getUpdates", { timeout: "soon" }), 30_000);
  });

  it("honours custom baseMs/longPollMarginMs — the operator escape hatch", () => {
    assert.equal(telegramRequestTimeoutMs("getMe", undefined, { baseMs: 5_000 }), 5_000);
    assert.equal(
      telegramRequestTimeoutMs("getUpdates", { timeout: 5 }, { longPollMarginMs: 1_000 }),
      6_000
    );
  });

  it("clamps a sub-1s baseMs up to 1s so a request can never self-abort instantly", () => {
    assert.equal(telegramRequestTimeoutMs("getMe", undefined, { baseMs: 10 }), 1_000);
  });
});

describe("every api() request is bounded (source pins)", () => {
  // runDoctor-style: the wiring below is only truly exercised by a live
  // hang (proven end-to-end further down for the base-budget path), so the
  // getUpdates-specific budget selection — which requires driving the full
  // poll loop through start() — is pinned at the source instead, the same
  // way doctor-no-duplicate-probes.test.mjs pins a call graph it can't run.
  const indexSrc = fs.readFileSync(
    new URL("../src/channels/telegram/index.mjs", import.meta.url),
    "utf8"
  );
  const pollLoopSrc = fs.readFileSync(
    new URL("../src/channels/telegram/poll-loop.mjs", import.meta.url),
    "utf8"
  );

  it("api()'s fetch call carries a signal derived from telegramRequestTimeoutMs(method, body, …)", () => {
    assert.match(
      indexSrc,
      /signal:\s*AbortSignal\.timeout\(\s*\n?\s*telegramRequestTimeoutMs\(method, body/,
      "without this, a hung request is unbounded again — the exact defect this file fixes"
    );
  });

  it("getUpdates sends its own long-poll window as body.timeout", () => {
    assert.match(
      pollLoopSrc,
      /timeout:\s*timeoutSec/,
      "telegramRequestTimeoutMs keys its long-poll budget off exactly this field"
    );
  });
});

describe("a hung Telegram request (real half-open socket)", () => {
  let server;
  let savedBase;
  const sockets = new Set();

  before(async () => {
    server = net.createServer((sock) => {
      sockets.add(sock);
      sock.on("close", () => sockets.delete(sock));
      // Accept the TCP connection and never write a byte back — a half-open
      // socket, the shape a NAT drop or a dead route produces (distinct
      // from a reset, which errors immediately). This is exactly the hang
      // api() must survive.
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    savedBase = process.env.XCLAW_TELEGRAM_API_BASE;
    process.env.XCLAW_TELEGRAM_API_BASE = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (savedBase === undefined) delete process.env.XCLAW_TELEGRAM_API_BASE;
    else process.env.XCLAW_TELEGRAM_API_BASE = savedBase;
    for (const s of sockets) s.destroy();
    await new Promise((resolve) => server.close(resolve));
  });

  it("aborts instead of hanging forever, and the resulting error classifies as TIMEOUT/retryable", async () => {
    const ch = createTelegramChannel({
      channels: {
        telegram: {
          enabled: true,
          token: FAKE_TOKEN,
          ownerChatId: "77",
          // Operator escape hatch, doubling as what keeps this test fast —
          // the default base budget is 30s.
          requestTimeoutMs: 200,
        },
      },
    });
    const startedAt = Date.now();
    const r = await ch.notifyOwnerApproval({ id: "p-hang", tool: "exec", args: {} });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(r.ok, false);
    assert.ok(
      elapsedMs < 5_000,
      `must abort well under the old unbounded hang (took ${elapsedMs}ms)`
    );

    const c = classifyTelegramError({ message: r.reason });
    assert.equal(c.code, "TIMEOUT", `expected TIMEOUT, got ${c.code} from "${r.reason}"`);
    assert.equal(c.retryable, true, "a timed-out request must be retried, not treated as fatal");
  });
});
