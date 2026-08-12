/**
 * Retry logic for OAuth token exchange + refresh.
 * Uses shared jittered backoff (full / equal / decorrelated).
 */
import {
  withBackoff,
  isTransientError,
  resolveJitterStrategy,
  getRetryAfterMs,
} from "../utils/backoff.mjs";
import { OAuthErrorCode } from "./oauth-errors.mjs";

const RETRYABLE_CODES = new Set([
  OAuthErrorCode.TOKEN_NETWORK,
  OAuthErrorCode.REFRESH_NETWORK,
  OAuthErrorCode.TOKEN_HTTP,
  OAuthErrorCode.REFRESH_HTTP,
  OAuthErrorCode.CALLBACK_PORT_BUSY,
]);

const NON_RETRYABLE_CODES = new Set([
  OAuthErrorCode.REFRESH_INVALID,
  OAuthErrorCode.STATE_MISMATCH,
  OAuthErrorCode.PROVIDER_DENIED,
  OAuthErrorCode.MISSING_CONFIG,
  OAuthErrorCode.MISSING_CODE,
  OAuthErrorCode.TOKEN_NO_ACCESS,
  OAuthErrorCode.NO_TOKEN,
  OAuthErrorCode.NO_REFRESH_TOKEN,
  OAuthErrorCode.NO_CLIENT_ID,
  OAuthErrorCode.EXPIRED_NO_REFRESH,
  OAuthErrorCode.UNKNOWN_APP,
]);

/**
 * True if an OAuth result/error should be retried.
 */
export function isOAuthRetryable(errOrResult) {
  if (!errOrResult) return false;
  if (errOrResult.retryable === false) return false;
  if (errOrResult.reauth === true) return false;

  const code = errOrResult.code;
  if (code && NON_RETRYABLE_CODES.has(code)) return false;
  if (code && RETRYABLE_CODES.has(code)) {
    // 4xx except 408/429 are usually not worth many retries
    const st = errOrResult.httpStatus ?? errOrResult.status;
    if (st != null && st >= 400 && st < 500 && st !== 408 && st !== 429) {
      // refresh_http / token_http on 400 without invalid_grant already classified
      // only retry 429/408 for client errors
      return st === 408 || st === 429;
    }
    return true;
  }
  if (errOrResult.retryable === true) return true;

  return isTransientError(errOrResult);
}

/**
 * Turn a { ok:false, retryable } result into a thrown error so withBackoff can retry.
 */
export function throwIfRetryableFailure(result) {
  if (result && result.ok === false && isOAuthRetryable(result)) {
    const err = new Error(result.error || result.code || "oauth retryable failure");
    Object.assign(err, result);
    err.status = result.httpStatus ?? result.status;
    throw err;
  }
  return result;
}

/**
 * Default OAuth retry options.
 */
export function oauthRetryDefaults(opts = {}) {
  return {
    retries: opts.retries ?? (Number(process.env.XCLAW_OAUTH_RETRIES) || 3),
    baseMs: opts.baseMs ?? (Number(process.env.XCLAW_OAUTH_RETRY_BASE_MS) || 300),
    maxDelayMs: opts.maxDelayMs ?? (Number(process.env.XCLAW_OAUTH_RETRY_MAX_MS) || 15_000),
    strategy: resolveJitterStrategy(opts.strategy || process.env.XCLAW_OAUTH_JITTER || "decorrelated"),
    respectRetryAfter: opts.respectRetryAfter !== false,
    shouldRetry: opts.shouldRetry || isOAuthRetryable,
    onRetry: opts.onRetry,
    signal: opts.signal,
  };
}

/**
 * Retry an async function that either throws or returns { ok:false }.
 * Final failure returns the last { ok:false } result when possible.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {object} [opts]
 * @returns {Promise<T>}
 */
export async function withOAuthRetry(fn, opts = {}) {
  const cfg = oauthRetryDefaults(opts);
  let lastResult;

  try {
    return await withBackoff(
      async () => {
        const result = await fn();
        lastResult = result;
        throwIfRetryableFailure(result);
        return result;
      },
      {
        ...cfg,
        onRetry: (info) => {
          if (opts.onRetry) opts.onRetry(info);
          else if (process.env.XCLAW_OAUTH_RETRY_LOG === "1") {
            console.error(
              `[oauth-retry] attempt ${info.attempt}/${info.retries} wait ${info.delayMs}ms`,
              info.error?.code || info.error?.message || ""
            );
          }
        },
      }
    );
  } catch (err) {
    if (lastResult && lastResult.ok === false) {
      return {
        ...lastResult,
        retriesExhausted: true,
        attempts: (cfg.retries ?? 3) + 1,
      };
    }
    if (err && err.ok === false) {
      return {
        ...err,
        error: err.error || err.message,
        retriesExhausted: true,
      };
    }
    // pure throw (network)
    return {
      ok: false,
      code: err?.code || OAuthErrorCode.TOKEN_NETWORK,
      error: err?.message || String(err),
      retryable: false,
      retriesExhausted: true,
      httpStatus: err?.status ?? err?.httpStatus,
    };
  }
}

export { getRetryAfterMs, RETRYABLE_CODES, NON_RETRYABLE_CODES };
