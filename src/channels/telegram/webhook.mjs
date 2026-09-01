/**
 * Telegram webhook transport (P0).
 * Validates secret_token header, optional single-writer lock.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { isPidAlive, isSameHost } from "../../shared/pid-alive.mjs";

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
 * telegram-writer.lock belongs to the config dir that owns the instance, not
 * to whoever's home dir the process happens to run under. Resolving it from
 * `os.homedir()` alone meant two instances on one host with different
 * `paths.configDir` shared a single lock, so instance B could not start
 * Telegram because A held it — and the suite wrote into the operator's real
 * `~/.xclaw/locks/telegram-writer.lock`.
 *
 * Production `createTelegramChannel(cfg)` already had cfg in scope and
 * passed `conf.writerLockPath` — when unset (normal), they homed. Doctor
 * independently homed the same path. `singleWriter !== false` is default-ON.
 * Same-bot sharing when they share configDir is still the point of the lock.
 *
 * `loadConfig()` stamps `paths.configDir` unconditionally
 * (config/load.mjs:187), so a cfg without one is never a real caller.
 * Such a path is `null` rather than guessing at the home dir. Same shape
 * as `defaultStatePath` in alerts.mjs / `resolvePairingStorePath` /
 * `defaultOffloadDir`. Honour opts.lockPath then
 * `channels.telegram.writerLockPath` then `paths.configDir`. No lock-path
 * env exists — do not invent one. `acquireTelegramWriterLock` no-ops a
 * null path (do not `mkdir(null)`).
 */
export function defaultTelegramWriterLockPath(opts = {}) {
  const explicit = opts.lockPath;
  if (typeof explicit === "string" && explicit) return explicit;
  const nested = opts.cfg?.channels?.telegram?.writerLockPath;
  if (typeof nested === "string" && nested) return nested;
  const dir = opts.cfg?.paths?.configDir;
  return dir ? path.join(dir, "locks", "telegram-writer.lock") : null;
}

/**
 * Single-writer lock so only one process owns Telegram updates.
 *
 * Reclaiming this lock while its holder still runs puts two processes on
 * `getUpdates` for one bot token, and Telegram then hands each a partial,
 * racing view — the exact failure the lock exists to prevent. So liveness is
 * asked of `isPidAlive`, which fails CLOSED on an ambiguous signal error (see
 * shared/pid-alive.mjs), rather than of a bare `catch` that reads another
 * uid's running process as gone.
 *
 * @param {object} [opts]
 * @param {string} [opts.lockPath]
 * @param {object} [opts.cfg]
 * @param {number} [opts.staleMs]
 * @param {(pid: number) => boolean} [opts.isAlive] seam: EPERM cannot be
 *   provoked under a single-uid deployment, so tests inject the verdict.
 */
export function acquireTelegramWriterLock(opts = {}) {
  const alivep = opts.isAlive || isPidAlive;
  const lockPath = defaultTelegramWriterLockPath(opts);
  const staleMs = opts.staleMs ?? 120_000;
  // No configDir / explicit path → skip the file (do not mkdir(null)).
  // Production threads cfg so live still locks under configDir.
  if (!lockPath) {
    return {
      ok: true,
      lockPath: null,
      skipped: true,
      release() {},
      touch() {},
    };
  }
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
      const fresh = age < staleMs;
      // The pid is only evidence on the host that minted it. `host` has been
      // recorded here since the lock existed but was never read, so on a shared
      // `~/.xclaw` (a bind-mounted volume, a restored home, NFS) a live remote
      // poller's pid was looked up in *this* process table, found missing, and
      // its lock taken — two processes on `getUpdates` for one token, the exact
      // failure this lock prevents. For a remote holder the renewal stamp is
      // the only signal we can interpret, and the owner refreshes it each poll.
      // Its pid number is not evidence either, so self-reacquire is local-only.
      const local = isSameHost(prev.host);
      const held = local ? alivep(prev.pid) && fresh && prev.pid !== process.pid : fresh;
      if (held) {
        return {
          ok: false,
          reason: local ? "lock_held" : "lock_held_remote",
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
        // Re-read before write. A hung getUpdates can return after staleMs
        // and another process has already reclaimed; stamping our in-memory
        // payload over theirs puts two processes on getUpdates for one token.
        // Same ownership check as release().
        try {
          const cur = JSON.parse(fs.readFileSync(lockPath, "utf8"));
          if (cur.pid !== process.pid) return;
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
  defaultTelegramWriterLockPath,
  acquireTelegramWriterLock,
  buildSetWebhookBody,
};
