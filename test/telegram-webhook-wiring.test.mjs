/**
 * The Telegram webhook's WIRING — not the pure verifier.
 *
 * verifyTelegramWebhookSecret() is unit-tested (telegram-p0), but the pure
 * function proves nothing about the CALL SITE. /channel/telegram/webhook is
 * deliberately EXEMPT from the gateway's main auth gate (isProtectedPath ===
 * false — see gateway-channel-auth), because it self-authenticates with
 * Telegram's secret header instead of a Bearer. So the ONLY thing standing
 * between a forged inbound POST and handleUpdate() running the bot is
 * handleWebhookRequest()'s refusal (src/channels/telegram/index.mjs):
 *
 *   const v = verifyTelegramWebhookSecret(req, webhookSecret || "");
 *   if (!v.ok) return { ok: false, ...v };   // <- the sole gate for inbound Telegram
 *   await handleUpdate(body);                 //    the side effect: process the update
 *
 * Why this file exists (3.199.0): NO test drove handleWebhookRequest. Deleting
 * that refusal line — so a POST with a WRONG or MISSING secret is processed as a
 * genuine Telegram update — left the full suite green (3507/0). A wiring
 * regression that dropped the check would ship, and an attacker who can reach the
 * (auth-exempt) webhook path could inject arbitrary inbound updates and drive the
 * agent. The pure-function unit test cannot catch this — only a test that drives
 * the wiring and observes whether the update was PROCESSED can.
 *
 * These tests observe the SIDE EFFECT through a mock Bot API: a refused request
 * makes ZERO outbound calls; an accepted one sends the pairing reply. They go RED
 * if the refusal is dropped (a forged update is processed) and RED if the accept
 * is inverted (a valid update is refused).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTelegramChannel } from "../src/channels/telegram/index.mjs";

const SECRET = "webhook-s3cret-value";
const HEADER = "x-telegram-bot-api-secret-token";

/** A mock Bot API that counts every outbound call. Zero hits === handleUpdate never ran. */
function createMockBotApi() {
  const state = { hits: 0, methods: [] };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      state.hits += 1;
      state.methods.push(req.url.split("/").pop());
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
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

describe("telegram webhook wiring: handleWebhookRequest is the sole gate", () => {
  let mock;
  let prevBase;
  let tmpDir;
  let seq = 0;

  before(async () => {
    mock = createMockBotApi();
    const port = await mock.listen();
    prevBase = process.env.XCLAW_TELEGRAM_API_BASE;
    process.env.XCLAW_TELEGRAM_API_BASE = `http://127.0.0.1:${port}`;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-tg-hook-"));
  });

  after(async () => {
    if (prevBase !== undefined) process.env.XCLAW_TELEGRAM_API_BASE = prevBase;
    else delete process.env.XCLAW_TELEGRAM_API_BASE;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await mock.close();
  });

  /**
   * A channel with a configured webhook secret. dmPolicy "pairing" + a
   * NON-matching allowlist forces gateTelegram()=false, so an unpaired DM takes
   * the pairing-reply branch (a deterministic outbound sendMessage) and never
   * reaches the agent. Pass secret:null to build an unconfigured-secret channel.
   */
  function mkChannel(secret = SECRET) {
    seq += 1;
    const telegram = {
      enabled: true,
      token: "TEST:token",
      transport: "webhook",
      dmPolicy: "pairing",
      allowedChatIds: ["1"], // never the probe chat -> gateTelegram false -> pairing branch
      pairingStorePath: path.join(tmpDir, `pairing-${seq}.json`),
    };
    if (secret) telegram.webhookSecret = secret;
    return createTelegramChannel({ channels: { telegram } });
  }

  /** A fresh unpaired private-DM update -> a first-time pairing request -> one outbound. */
  function dmUpdate() {
    seq += 1;
    const chatId = 900000 + seq;
    return {
      update_id: chatId,
      message: {
        message_id: 10,
        text: "hello",
        chat: { id: chatId, type: "private" },
        from: { id: chatId, username: "probe" },
      },
    };
  }

  it("accepts the correct secret and PROCESSES the update (outbound fires)", async () => {
    const ch = mkChannel();
    const before = mock.state.hits;
    const r = await ch.handleWebhookRequest({ headers: { [HEADER]: SECRET } }, dmUpdate());
    assert.equal(r.ok, true, "the correct secret must be accepted");
    assert.ok(
      mock.state.hits > before,
      "handleUpdate must run on an accepted webhook -> at least one outbound Bot API call"
    );
  });

  it("REFUSES a wrong secret and does NOT process the update (zero outbound)", async () => {
    const ch = mkChannel();
    const before = mock.state.hits;
    const r = await ch.handleWebhookRequest({ headers: { [HEADER]: "WRONG-secret" } }, dmUpdate());
    assert.equal(r.ok, false, "a wrong secret must be refused");
    assert.equal(r.reason, "bad_secret");
    assert.equal(
      mock.state.hits,
      before,
      "a forged update must NOT reach handleUpdate -> zero outbound calls"
    );
  });

  it("REFUSES a missing secret header and does NOT process the update (zero outbound)", async () => {
    const ch = mkChannel();
    const before = mock.state.hits;
    const r = await ch.handleWebhookRequest({ headers: {} }, dmUpdate());
    assert.equal(r.ok, false, "a missing secret header must be refused");
    assert.equal(r.reason, "missing_secret_header");
    assert.equal(
      mock.state.hits,
      before,
      "a headerless update must NOT reach handleUpdate -> zero outbound calls"
    );
  });

  it("fails CLOSED when no webhook secret is configured (refuses even a plausible header)", async () => {
    const ch = mkChannel(null);
    const before = mock.state.hits;
    const r = await ch.handleWebhookRequest({ headers: { [HEADER]: "anything" } }, dmUpdate());
    assert.equal(r.ok, false, "an unconfigured secret must fail closed, not fall open");
    assert.equal(r.reason, "secret_not_configured");
    assert.equal(
      mock.state.hits,
      before,
      "an unconfigured webhook must NOT process updates -> zero outbound calls"
    );
  });
});
