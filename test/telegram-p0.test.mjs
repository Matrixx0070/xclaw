import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  timingSafeEqualStr,
  verifyTelegramWebhookSecret,
  buildSetWebhookBody,
  acquireTelegramWriterLock,
  TELEGRAM_SECRET_HEADER,
} from "../src/channels/telegram/webhook.mjs";
import {
  pairingInlineKeyboard,
  approvalInlineKeyboard,
  parseCallbackData,
} from "../src/channels/telegram/inline.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("telegram webhook P0", () => {
  it("timingSafeEqualStr", () => {
    assert.equal(timingSafeEqualStr("abc", "abc"), true);
    assert.equal(timingSafeEqualStr("abc", "abd"), false);
    assert.equal(timingSafeEqualStr("abc", "ab"), false);
  });

  it("verifyTelegramWebhookSecret", () => {
    const req = { headers: { [TELEGRAM_SECRET_HEADER]: "s3cret" } };
    assert.equal(verifyTelegramWebhookSecret(req, "s3cret").ok, true);
    assert.equal(verifyTelegramWebhookSecret(req, "wrong").ok, false);
    assert.equal(verifyTelegramWebhookSecret({ headers: {} }, "s3cret").ok, false);
  });

  it("buildSetWebhookBody includes secret", () => {
    const b = buildSetWebhookBody({
      url: "https://example.com/hook",
      secretToken: "tok",
    });
    assert.equal(b.url, "https://example.com/hook");
    assert.equal(b.secret_token, "tok");
    assert.ok(b.allowed_updates.includes("callback_query"));
  });

  it("writer lock acquire/release", () => {
    const lockPath = path.join(os.tmpdir(), `xclaw-tg-lock-${process.pid}.lock`);
    try {
      fs.unlinkSync(lockPath);
    } catch {
      /* */
    }
    const a = acquireTelegramWriterLock({ lockPath, staleMs: 60_000 });
    assert.equal(a.ok, true);
    // Same PID is re-entrant (gateway restart path); foreign PID would block
    const b = acquireTelegramWriterLock({ lockPath, staleMs: 60_000 });
    assert.equal(b.ok, true);
    a.release();
    // After release, lock file gone or stale — acquire again
    const c = acquireTelegramWriterLock({ lockPath, staleMs: 60_000 });
    assert.equal(c.ok, true);
    c.release();
  });
});

describe("telegram inline P0", () => {
  it("pairing keyboard callback under 64 chars", () => {
    const kb = pairingInlineKeyboard({ code: "AB12CD", chatId: 1 });
    const data = kb.inline_keyboard[0][0].callback_data;
    assert.ok(data.length <= 64);
    const p = parseCallbackData(data);
    assert.equal(p.kind, "pair");
    assert.equal(p.action, "approve");
    assert.equal(p.id, "AB12CD");
  });

  it("approval keyboard parse", () => {
    const kb = approvalInlineKeyboard({ pendingId: "apr_1_xyz", tool: "bash" });
    const data = kb.inline_keyboard[0][1].callback_data;
    const p = parseCallbackData(data);
    assert.equal(p.kind, "apr");
    assert.equal(p.action, "no");
    assert.match(p.id, /apr_/);
  });
});
