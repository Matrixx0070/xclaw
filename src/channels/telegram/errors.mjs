/**
 * Telegram Bot API error classification and safe user messages.
 */

/**
 * @param {unknown} err
 * @returns {{
 *   code: string,
 *   retryable: boolean,
 *   retryAfterSec: number|null,
 *   message: string,
 *   userMessage: string,
 *   raw?: string
 * }}
 */
export function classifyTelegramError(err) {
  const raw = String(err?.message || err || "");
  const status = err?.status ?? err?.statusCode ?? null;
  const description = err?.description || raw;

  // Retry-After from 429
  let retryAfterSec = null;
  const ra =
    err?.retryAfter ??
    err?.parameters?.retry_after ??
    raw.match(/retry after (\d+)/i)?.[1];
  if (ra != null && Number.isFinite(Number(ra))) {
    retryAfterSec = Number(ra);
  }

  if (/abor|ETIMEDOUT|timeout/i.test(raw) || err?.code === "ETIMEDOUT") {
    return {
      code: "TIMEOUT",
      retryable: true,
      retryAfterSec: retryAfterSec ?? 2,
      message: description,
      userMessage: "Telegram timed out — retrying.",
      raw,
    };
  }
  if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(raw)) {
    return {
      code: "NETWORK",
      retryable: true,
      retryAfterSec: retryAfterSec ?? 3,
      message: description,
      userMessage: "Network error talking to Telegram.",
      raw,
    };
  }
  if (/409|Conflict|terminated by other getUpdates|can't use getUpdates/i.test(raw)) {
    return {
      code: "CONFLICT",
      retryable: true,
      retryAfterSec: retryAfterSec ?? 1,
      message: description,
      userMessage: "Another poller or webhook is active.",
      raw,
    };
  }
  if (/401|Unauthorized|invalid token/i.test(raw) || status === 401) {
    return {
      code: "UNAUTHORIZED",
      retryable: false,
      retryAfterSec: null,
      message: description,
      userMessage: "Bot token invalid — check channels.telegram.token.",
      raw,
    };
  }
  if (/403|Forbidden|blocked by the user|bot was blocked/i.test(raw) || status === 403) {
    return {
      code: "FORBIDDEN",
      retryable: false,
      retryAfterSec: null,
      message: description,
      userMessage: "Bot cannot message this chat (blocked or no rights).",
      raw,
    };
  }
  if (/429|Too Many Requests/i.test(raw) || status === 429) {
    return {
      code: "RATE_LIMIT",
      retryable: true,
      retryAfterSec: retryAfterSec ?? 5,
      message: description,
      userMessage: "Telegram rate limit — backing off.",
      raw,
    };
  }
  if (/400|Bad Request|message is not modified|chat not found/i.test(raw) || status === 400) {
    const notModified = /not modified/i.test(raw);
    return {
      code: notModified ? "NOT_MODIFIED" : "BAD_REQUEST",
      retryable: false,
      retryAfterSec: null,
      message: description,
      userMessage: notModified
        ? "Message unchanged."
        : "Telegram rejected the request.",
      raw,
    };
  }

  return {
    code: "UNKNOWN",
    retryable: true,
    retryAfterSec: retryAfterSec ?? 2,
    message: description,
    userMessage: "Telegram error.",
    raw,
  };
}

/**
 * Build Error with Telegram API response fields.
 */
export function telegramApiError(method, result, status) {
  const err = new Error(
    `Telegram ${method}: ${result?.description || status || "failed"}`
  );
  err.status = status;
  err.description = result?.description;
  err.parameters = result?.parameters;
  if (result?.parameters?.retry_after != null) {
    err.retryAfter = result.parameters.retry_after;
  }
  return err;
}

/**
 * Safe delay ms from classification.
 */
export function backoffMsFromClassification(c, attempt = 0) {
  if (c.retryAfterSec != null) {
    return Math.min(60_000, Math.max(500, c.retryAfterSec * 1000));
  }
  const base = c.retryable ? 2000 : 5000;
  const exp = Math.min(30_000, base * Math.pow(1.6, Math.min(attempt, 8)));
  const jitter = Math.floor(Math.random() * 1000);
  return exp + jitter;
}


/**
 * Redact a bot token from error/log text (sweep #71). Telegram API URLs
 * embed the token (`/bot<token>/…`); runtime errors can echo the full
 * URL (proven: fetch's "Failed to parse URL from …" carries it), and
 * those messages flow into classifier `raw`, pm2 logs, and even
 * agent-visible media-failure text. Applied at the api()/download
 * boundaries so no error path can carry the credential outward.
 */
export function redactTelegramToken(text, token) {
  const s = String(text ?? "");
  if (!token) return s;
  return s.split(String(token)).join("<token>");
}

export default {
  classifyTelegramError,
  telegramApiError,
  backoffMsFromClassification,
  redactTelegramToken,
};
