/**
 * Sweep #71 — the bot token must never reach error/log egress. Telegram
 * API URLs embed the token; a runtime error can echo the full URL
 * (REPRODUCED: fetch's "Failed to parse URL from <url>" carries it),
 * and api()'s wrapped message flows into classifier raw, pm2 logs, and
 * agent-visible media-failure text. Pins the live repro end-to-end (a
 * misconfigured API base must yield "<token>", never the credential)
 * and the pure redactor.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTelegramChannel } from "../src/channels/telegram/index.mjs";
import { redactTelegramToken } from "../src/channels/telegram/errors.mjs";

const FAKE_TOKEN = "0000:FAKE-not-a-real-telegram-token-abcdef";
let savedBase;

describe("telegram token redaction (sweep #71)", () => {
  before(() => {
    savedBase = process.env.XCLAW_TELEGRAM_API_BASE;
    // Unparseable base → fetch throws "Failed to parse URL from <full url>"
    // with the token embedded — the reproduced leak vector.
    process.env.XCLAW_TELEGRAM_API_BASE = "http://[bad";
  });
  after(() => {
    if (savedBase === undefined) delete process.env.XCLAW_TELEGRAM_API_BASE;
    else process.env.XCLAW_TELEGRAM_API_BASE = savedBase;
  });

  it("an error that echoes the request URL surfaces <token>, never the credential", async () => {
    const ch = createTelegramChannel({
      channels: { telegram: { enabled: true, token: FAKE_TOKEN, ownerChatId: "77" } },
    });
    const r = await ch.notifyOwnerApproval({ id: "p-leak", tool: "exec", args: {} });
    assert.equal(r.ok, false);
    assert.equal(String(r.reason).includes(FAKE_TOKEN), false, "the token must never appear in error egress");
    assert.match(String(r.reason), /<token>/, "the redaction marker proves the URL path was hit");
  });

  it("redactTelegramToken replaces every occurrence and is safe on empty inputs", () => {
    assert.equal(
      redactTelegramToken(`a ${FAKE_TOKEN} b ${FAKE_TOKEN}`, FAKE_TOKEN),
      "a <token> b <token>",
    );
    assert.equal(redactTelegramToken("plain", FAKE_TOKEN), "plain");
    assert.equal(redactTelegramToken(null, FAKE_TOKEN), "");
    assert.equal(redactTelegramToken("keep", null), "keep");
    assert.equal(redactTelegramToken("keep", ""), "keep");
  });
});
