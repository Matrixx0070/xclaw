/**
 * Telegram inline callback authorization (pair / apr / sug).
 * Codes: CALLBACK_DENY | CALLBACK_NO_USER | RATE_LIMITED
 */

/**
 * @param {object} opts
 * @param {string|number|null} opts.fromId
 * @param {string|number|null} opts.chatId
 * @param {{ kind?: string }} opts.data
 * @param {string|null} opts.ownerChatId
 * @param {string} opts.dmPolicy open|allowlist|pairing
 * @param {Array<string|number>} opts.allowFrom
 * @param {(channel: string, id: string) => boolean} [opts.isApproved]
 * @param {{ allow: (key: string) => { ok: boolean, retryAfterMs?: number } }} [opts.rateLimiter]
 */
export function authorizeTelegramCallback(opts) {
  const fromId = opts.fromId != null ? String(opts.fromId) : "";
  const chatId = opts.chatId != null ? String(opts.chatId) : fromId;
  const data = opts.data || {};
  const ownerChatId = opts.ownerChatId != null ? String(opts.ownerChatId) : "";
  const dmPolicy = opts.dmPolicy || "pairing";
  const allow = (opts.allowFrom || []).map(String);
  const isApproved = opts.isApproved || (() => false);

  if (!fromId) {
    return { ok: false, code: "CALLBACK_NO_USER", message: "Not authorized" };
  }

  if (opts.rateLimiter) {
    const rl = opts.rateLimiter.allow(`telegram-cb:${chatId}:${fromId}`);
    if (!rl.ok) {
      return {
        ok: false,
        code: "RATE_LIMITED",
        message: "Rate limit",
        retryAfterMs: rl.retryAfterMs ?? null,
      };
    }
  }

  if (ownerChatId && fromId === ownerChatId) {
    return { ok: true, via: "owner" };
  }

  const inAllow = allow.includes(fromId) || allow.includes(chatId);

  if (data.kind === "sug") {
    if (dmPolicy === "allowlist" && !inAllow) {
      return { ok: false, code: "CALLBACK_DENY", message: "Not authorized" };
    }
    if (dmPolicy === "pairing") {
      if (!isApproved("telegram", chatId) && !isApproved("telegram", fromId) && !inAllow) {
        return { ok: false, code: "CALLBACK_DENY", message: "Not authorized" };
      }
    }
    return { ok: true, via: "sug_policy" };
  }

  if (data.kind === "pair" || data.kind === "apr") {
    if (ownerChatId && fromId !== ownerChatId) {
      return { ok: false, code: "CALLBACK_DENY", message: "Not authorized" };
    }
    if (!ownerChatId) {
      if (dmPolicy === "open") {
        return {
          ok: false,
          code: "CALLBACK_DENY",
          message: "Admin callbacks require ownerChatId",
        };
      }
      if (inAllow) return { ok: true, via: "allowlist" };
      return { ok: false, code: "CALLBACK_DENY", message: "Not authorized" };
    }
  }

  return { ok: true, via: "default" };
}

export default { authorizeTelegramCallback };
