/**
 * Telegram webhook transport (P0).
 * Validates secret_token header, optional single-writer lock.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";

/**
 * @param {string} expected
 * @param {string} got
 */
export function timingSafeEqualStr(expected, got) {
  const a = Buffer.from(String(expected || ""), "utf8");
  const b = Buffer.from(String(got || ""), "utf8");
  if (a.length !== b.length) {
    // still do a compare to reduce timing leak on length
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {string} secret
 */
export function verifyTelegramWebhookSecret(req, secret) {
  if (!secret) {
    return { ok: false, reason: "secret_not_configured" };
  }
  const got =
    req.headers?.[TELEGRAM_SECRET_HEADER] ||
    req.headers?.["X-Telegram-Bot-Api-Secret-Token"];
  if (!got) return { ok: false, reason: "missing_secret_header" };
  if (!timingSafeEqualStr(secret, String(got))) {
    return { ok: false, reason: "bad_secret" };
  }
  return { ok: true };
}

/**
 * Single-writer lock so only one process owns Telegram updates.
 * @param {object} [opts]
 * @param {string} [opts.lockPath]
 * @param {number} [opts.staleMs]
 */
export function acquireTelegramWriterLock(opts = {}) {
  const lockPath =
    opts.lockPath ||
    path.join(os.homedir(), ".xclaw", "locks", "telegram-writer.lock");
  const staleMs = opts.staleMs ?? 120_000;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  const payload = {
    pid: process.pid,
    at: new Date().toISOString(),
    host: os.hostname(),
  };

  try {
    if (fs.existsSync(lockPath)) {
      const raw = fs.readFileSync(lockPath, "utf8");
      let prev = {};
      try {
        prev = JSON.parse(raw);
      } catch {
        /* */
      }
      const age = Date.now() - Date.parse(prev.at || 0);
      const alive =
        prev.pid &&
        (() => {
          try {
            process.kill(prev.pid, 0);
            return true;
          } catch {
            return false;
          }
        })();
      if (alive && age < staleMs && prev.pid !== process.pid) {
        return {
          ok: false,
          reason: "lock_held",
          holder: prev,
          lockPath,
        };
      }
    }
    fs.writeFileSync(lockPath, JSON.stringify(payload, null, 2), "utf8");
    return {
      ok: true,
      lockPath,
      release() {
        try {
          const cur = JSON.parse(fs.readFileSync(lockPath, "utf8"));
          if (cur.pid === process.pid) fs.unlinkSync(lockPath);
        } catch {
          /* */
        }
      },
      touch() {
        try {
          payload.at = new Date().toISOString();
          fs.writeFileSync(lockPath, JSON.stringify(payload, null, 2), "utf8");
        } catch {
          /* */
        }
      },
    };
  } catch (err) {
    return { ok: false, reason: String(err.message || err), lockPath };
  }
}

/**
 * Build setWebhook body for Bot API.
 */
export function buildSetWebhookBody({ url, secretToken, allowedUpdates, dropPending = true }) {
  const body = {
    url,
    drop_pending_updates: dropPending !== false,
    allowed_updates: allowedUpdates || [
      "message",
      "edited_message",
      "callback_query",
    ],
  };
  if (secretToken) body.secret_token = secretToken;
  return body;
}

export default {
  TELEGRAM_SECRET_HEADER,
  timingSafeEqualStr,
  verifyTelegramWebhookSecret,
  acquireTelegramWriterLock,
  buildSetWebhookBody,
};
