/**
 * The composite pairing GATE wiring — `!staticOk && !approved` at the live call site.
 *
 * In dmPolicy:"pairing" the live handler admits a DM iff a STATIC allowlist match
 * OR an APPROVED pairing (src/channels/telegram/index.mjs:625-652):
 *
 *   const allowedStatic = policy.gateTelegram(update).ok;
 *   const approved = pairing.isApproved("telegram", chatId);
 *   if (!allowedStatic && !approved) { ...pairing request...; return; }  // <- stops here
 *
 * The two ARMS are pinned in isolation — the static allowlist (isSenderIdAllowed
 * sweep #21 / gateTelegram #23) and the pure isApproved store (#24). But every one
 * of those files carries the SAME honest limit (pairing-approved-gate.test.mjs:25):
 * "this pins the pure store decision, not the channel handler's `!staticOk &&
 * !approved` combination, which stays untested wiring." No test drove the ADMIT
 * direction through the real handler: that an allowed/approved DM actually gets
 * PAST the gate, nor that `approved` is even consulted at THIS call site.
 *
 * Why it matters (sweep #30, 3.212.0): the same mock-Bot-API seam the webhook-
 * wiring test uses is enough — an admitted `/status` DM sends a DETERMINISTIC
 * reply ("XClaw Telegram up …") and returns BEFORE the agent runs (index.mjs:695),
 * so the admit direction is observable with no model call. Dropping the approval
 * arm — `if (!allowedStatic)` — so an APPROVED (but not statically-allowed) sender
 * is re-pairing-requested instead of admitted, left the FULL suite green: the
 * wiring that consults `approved` at the call site could silently break and ship.
 * The pure-store test (#24) cannot catch this — only a test that drives the handler
 * and observes admission can. This closes the honest limit carried since #21/#23/#24
 * for the Telegram channel. (Discord is the twin — its handler has no webhook-style
 * seam; still open, recorded as the next candidate.)
 *
 * These pin BOTH admit arms AND the deny direction through the live handler:
 *  - static-allowlist match -> ADMITTED (reaches /status reply, no pairing request)
 *  - pairing approval       -> ADMITTED (proves `approved` is consulted here)
 *  - neither                -> DENIED  (pairing reply + a pending request recorded)
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTelegramChannel } from "../src/channels/telegram/index.mjs";
import { createPairingStore } from "../src/pairing/pairing-store.mjs";
import { configureSessionPersist } from "../src/sessions/router.mjs";

const SECRET = "wiring-secret-value";
const HEADER = "x-telegram-bot-api-secret-token";

/** A mock Bot API that captures each outbound call's method + text + chat id. */
function createMockBotApi() {
  const state = { calls: [] };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        /* non-JSON call (unused) */
      }
      state.calls.push({
        method: req.url.split("/").pop(),
        text: parsed.text,
        chatId: parsed.chat_id,
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    });
  });
  return {
    state,
    async listen() {
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      return server.address().port;
    },
    async close() {
      await new Promise((r) => server.close(r));
    },
  };
}

describe("pairing gate wiring: !staticOk && !approved at the live call site", () => {
  let mock;
  let prevBase;
  let tmpDir;
  let seq = 0;

  before(async () => {
    mock = createMockBotApi();
    const port = await mock.listen();
    prevBase = process.env.XCLAW_TELEGRAM_API_BASE;
    process.env.XCLAW_TELEGRAM_API_BASE = `http://127.0.0.1:${port}`;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-pair-wire-"));
    // Hermetic sessions: an admitted DM resolves a binding; keep that in-memory,
    // no writes to ~/.xclaw and no load of real state. (node --test isolates each
    // file in its own process, so this module-global stays contained.)
    configureSessionPersist({
      path: path.join(tmpDir, "sessions.json"),
      enabled: false,
      load: false,
    });
  });

  after(async () => {
    if (prevBase !== undefined) process.env.XCLAW_TELEGRAM_API_BASE = prevBase;
    else delete process.env.XCLAW_TELEGRAM_API_BASE;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await mock.close();
  });

  function storePath() {
    seq += 1;
    return path.join(tmpDir, `pair-${seq}.json`);
  }

  function mkChannel({ allowedChatIds, pairingStorePath }) {
    const telegram = {
      enabled: true,
      token: "TEST:token",
      transport: "webhook",
      dmPolicy: "pairing",
      webhookSecret: SECRET,
      workingDir: tmpDir,
      allowedChatIds,
      pairingStorePath,
    };
    return createTelegramChannel({ channels: { telegram } });
  }

  /** A private-DM `/status` update: an admitted sender sends a deterministic reply
   *  and returns before the agent runs. from.id === chat.id so the static arm
   *  matches whether it keys on sender or chat. */
  function statusDm(chatId) {
    return {
      update_id: chatId,
      message: {
        message_id: 10,
        text: "/status",
        chat: { id: chatId, type: "private" },
        from: { id: chatId, username: "probe" },
      },
    };
  }

  async function drive(ch, update) {
    const start = mock.state.calls.length;
    const r = await ch.handleWebhookRequest({ headers: { [HEADER]: SECRET } }, update);
    assert.equal(r.ok, true, "correct secret must be accepted so handleUpdate runs");
    return mock.state.calls.slice(start).find((c) => c.method === "sendMessage");
  }

  it("ADMITS a statically-allowlisted DM (reaches /status, not the pairing reply)", async () => {
    const chatId = 700001;
    const sp = storePath();
    const ch = mkChannel({ allowedChatIds: [String(chatId)], pairingStorePath: sp });
    const sent = await drive(ch, statusDm(chatId));
    assert.ok(sent, "an admitted DM must produce an outbound reply");
    assert.ok(
      sent.text.startsWith("XClaw Telegram up"),
      `a statically-allowed DM must be ADMITTED to /status, got: ${String(sent.text).slice(0, 48)}`
    );
    const pending = createPairingStore({ storePath: sp }).listPending("telegram");
    assert.equal(pending.length, 0, "an admitted sender must NOT be pairing-requested");
  });

  it("ADMITS a pairing-APPROVED DM — proves `approved` is consulted at the call site", async () => {
    const chatId = 700002;
    const sp = storePath();
    // Pre-seed an APPROVED pairing for this sender; NON-matching static allowlist,
    // so ONLY the approval arm can admit. Dropping `&& !approved` re-pairs this DM.
    const seed = createPairingStore({ storePath: sp });
    const { code } = seed.upsertPairingRequest({ channel: "telegram", id: String(chatId) });
    assert.equal(seed.approve("telegram", code).ok, true, "setup: approve must succeed");
    const ch = mkChannel({ allowedChatIds: ["1"], pairingStorePath: sp });
    const sent = await drive(ch, statusDm(chatId));
    assert.ok(sent, "an approved DM must produce an outbound reply");
    assert.ok(
      sent.text.startsWith("XClaw Telegram up"),
      `an approved DM must be ADMITTED (dropping && !approved re-pairs it), got: ${String(sent.text).slice(0, 48)}`
    );
  });

  it("DENIES a DM that is neither allowlisted nor approved (pairing reply + pending request)", async () => {
    const chatId = 700003;
    const sp = storePath();
    const ch = mkChannel({ allowedChatIds: ["1"], pairingStorePath: sp });
    const sent = await drive(ch, statusDm(chatId));
    assert.ok(sent, "a denied DM sends the pairing reply");
    assert.ok(
      sent.text.startsWith("XClaw: access not configured"),
      `an unpaired DM must get the pairing reply, got: ${String(sent.text).slice(0, 48)}`
    );
    const pending = createPairingStore({ storePath: sp }).listPending("telegram");
    assert.equal(pending.length, 1, "a denied sender must be recorded as a pending pairing request");
    assert.equal(String(pending[0].id), String(chatId));
  });
});
