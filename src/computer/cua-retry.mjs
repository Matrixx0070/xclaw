/**
 * Retry helper for transient CUA failures (CDP attach, motor exec, helper spawn).
 * Permanent codes (DISABLED, NEED_*, UNKNOWN) are never retried.
 */

/** Codes safe to retry (network / race / brief CDP blip). */
export const CUA_TRANSIENT_CODES = new Set([
  "CDP_ATTACH_FAILED",
  "CUA_ACT_EXEC_FAILED",
  "ATSPI_EXEC_FAILED",
  "ATSPI_EMPTY",
  "ATSPI_REGISTRY_FAILED",
  "UIA_EXEC_FAILED",
  "UIA_EMPTY",
  "UIA_ACT_FAILED",
  "AX_EXEC_FAILED",
  "AX_EMPTY",
  "AX_ACT_FAILED",
  "OBSERVE_EXEC_FAILED",
  "DESKTOP_ACT_FAILED",
]);

/**
 * @param {unknown} errOrResult
 * @returns {string|null}
 */
export function extractCuaCode(errOrResult) {
  if (!errOrResult) return null;
  if (typeof errOrResult === "object") {
    if (errOrResult.code) return String(errOrResult.code);
    if (errOrResult.message && /CDP attach/i.test(errOrResult.message)) return "CDP_ATTACH_FAILED";
  }
  if (errOrResult instanceof Error) {
    if (/ECONNREFUSED|ETIMEDOUT|ECONNRESET|socket hang up/i.test(errOrResult.message)) {
      return "CDP_ATTACH_FAILED";
    }
  }
  return null;
}

/**
 * @param {string|null|undefined} code
 * @param {Error|null} [err]
 */
export function isTransientCuaFailure(code, err = null) {
  if (code && CUA_TRANSIENT_CODES.has(code)) return true;
  if (err && /ECONNREFUSED|ETIMEDOUT|ECONNRESET|socket hang up|EPIPE/i.test(err.message || "")) {
    return true;
  }
  return false;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error("aborted"), { code: "ABORT_ERR" }));
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(Object.assign(new Error("aborted"), { code: "ABORT_ERR" }));
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

/**
 * Exponential backoff with jitter.
 * @param {number} attempt 0-based
 * @param {{ baseMs?: number, maxMs?: number, factor?: number, jitter?: number }} opts
 */
export function backoffMs(attempt, opts = {}) {
  const base = opts.baseMs ?? 100;
  const max = opts.maxMs ?? 5000;
  const factor = opts.factor ?? 2;
  const jitter = opts.jitter ?? 0.25;
  const raw = Math.min(max, base * factor ** attempt);
  const j = raw * jitter * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(raw + j));
}

/**
 * Retry an async function that returns `{ ok, code?, ... }` or throws.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{
 *   retries?: number,
 *   baseMs?: number,
 *   maxMs?: number,
 *   factor?: number,
 *   jitter?: number,
 *   signal?: AbortSignal,
 *   onRetry?: (info: { attempt: number, delayMs: number, code?: string, error?: string }) => void,
 *   isRetryable?: (result: T|null, err: Error|null) => boolean,
 * }} [opts]
 * @returns {Promise<T & { retries?: number, retried?: boolean }>}
 */
export async function withCuaRetry(fn, opts = {}) {
  const retries = Math.max(0, opts.retries ?? 2);
  const isRetryable =
    opts.isRetryable ||
    ((result, err) => {
      if (err) return isTransientCuaFailure(extractCuaCode(err), err);
      if (result && result.ok === false) {
        return isTransientCuaFailure(result.code, null);
      }
      return false;
    });

  let lastResult = null;
  let lastErr = null;
  let attempts = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    attempts = attempt + 1;
    try {
      const result = await fn();
      lastResult = result;
      lastErr = null;
      if (result && result.ok === false && attempt < retries && isRetryable(result, null)) {
        const delay = backoffMs(attempt, opts);
        opts.onRetry?.({
          attempt: attempt + 1,
          delayMs: delay,
          code: result.code,
          error: result.error,
        });
        await sleep(delay, opts.signal);
        continue;
      }
      if (result && typeof result === "object") {
        return {
          ...result,
          retries: attempts - 1,
          retried: attempts > 1,
        };
      }
      return result;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt < retries && isRetryable(null, lastErr)) {
        const delay = backoffMs(attempt, opts);
        opts.onRetry?.({
          attempt: attempt + 1,
          delayMs: delay,
          code: extractCuaErrorCode(lastErr),
          error: lastErr.message,
        });
        await sleep(delay, opts.signal);
        continue;
      }
      throw lastErr;
    }
  }

  if (lastResult && typeof lastResult === "object") {
    return { ...lastResult, retries: attempts - 1, retried: attempts > 1 };
  }
  if (lastErr) throw lastErr;
  return lastResult;
}

function extractCuaErrorCode(err) {
  return extractCuaCode(err);
}

export default {
  CUA_TRANSIENT_CODES,
  withCuaRetry,
  backoffMs,
  isTransientCuaFailure,
  extractCuaCode,
};
