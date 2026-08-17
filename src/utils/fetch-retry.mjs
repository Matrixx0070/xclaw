/**
 * Network fetch with transient retry (full-jitter backoff).
 * Use for outbound HTTP from providers, tools, and channel delivery.
 */
import {
  withBackoff,
  isTransientError,
  getRetryAfterMs,
} from "./backoff.mjs";

/**
 * @param {string|URL} url
 * @param {RequestInit & {
 *   retries?: number,
 *   baseMs?: number,
 *   maxDelayMs?: number,
 *   timeoutMs?: number,
 *   retryOnHttp?: number[],
 *   onRetry?: Function,
 * }} [init]
 */
export async function fetchWithRetry(url, init = {}) {
  const {
    retries = 3,
    baseMs = 200,
    maxDelayMs = 12_000,
    timeoutMs,
    retryOnHttp = [408, 425, 429, 500, 502, 503, 504],
    onRetry,
    signal: outerSignal,
    ...fetchInit
  } = init;

  return withBackoff(
    async () => {
      let signal = outerSignal;
      let timer;
      if (timeoutMs && !outerSignal) {
        const ctrl = new AbortController();
        timer = setTimeout(() => ctrl.abort(), timeoutMs);
        if (timer.unref) timer.unref();
        signal = ctrl.signal;
      }
      try {
        const res = await fetch(url, { ...fetchInit, signal });
        if (!res.ok && retryOnHttp.includes(res.status)) {
          const err = new Error(`HTTP ${res.status} ${res.statusText || ""}`.trim());
          err.status = res.status;
          err.response = res;
          // Attach Retry-After if present
          const ra = res.headers?.get?.("retry-after");
          if (ra) err.retryAfter = ra;
          throw err;
        }
        return res;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    {
      retries,
      baseMs,
      maxDelayMs,
      strategy: "full",
      signal: outerSignal,
      shouldRetry: (err) => {
        if (err?.status && retryOnHttp.includes(err.status)) return true;
        return isTransientError(err);
      },
      onRetry,
      respectRetryAfter: true,
    }
  );
}

/**
 * fetchWithRetry + res.json(); throws on !ok after retries exhausted.
 */
export async function fetchJsonWithRetry(url, init = {}) {
  const res = await fetchWithRetry(url, init);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export default { fetchWithRetry, fetchJsonWithRetry };
