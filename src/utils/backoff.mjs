/**
 * Jittered backoff strategies for transient retries (XClaw).
 *
 * Strategies:
 *   - full:        delay ~ U(0, base * 2^attempt)          // AWS "full jitter"
 *   - equal:       delay = half + U(0, half)               // AWS "equal jitter"
 *   - decorrelated: delay ~ U(base, prev * 3) capped       // AWS "decorrelated jitter"
 *   - none:        pure exponential, no random             // tests / determinism
 *
 * Retry-After (HTTP 429/503):
 *   - integer seconds  → wait that many seconds
 *   - HTTP-date        → wait until that time
 * Server hint wins when present, then clamped to maxDelayMs.
 * Optional small jitter on top of Retry-After to desynchronize clients.
 *
 * All delays are clamped to [0, maxDelayMs].
 */

/** @typedef {"full" | "equal" | "decorrelated" | "none"} JitterStrategy */

/** Supported jitter strategy ids (AWS-style + deterministic). */
export const JITTER_STRATEGIES = Object.freeze([
  "full",
  "equal",
  "decorrelated",
  "none",
]);

/**
 * Normalize strategy name; unknown values fall back to "full".
 * @param {string} [name]
 * @returns {JitterStrategy}
 */
export function resolveJitterStrategy(name) {
  const s = String(name || "full").toLowerCase().trim();
  if (s === "full_jitter" || s === "full-jitter") return "full";
  if (s === "equal_jitter" || s === "equal-jitter") return "equal";
  if (s === "decorrelated_jitter" || s === "decorrelated-jitter") return "decorrelated";
  if (s === "exponential" || s === "exp") return "none";
  if (JITTER_STRATEGIES.includes(s)) return /** @type {JitterStrategy} */ (s);
  return "full";
}

/**
 * Coerce to a finite number, falling back when the value is absent or is not a
 * number at all. Every knob below is multiplied or compared into a delay, and
 * NaN survives both operations: `Math.min(NaN, x)` is NaN, and `NaN <= 0` is
 * false — so the guard that skips a zero delay does not fire, and setTimeout
 * coerces the NaN to 0. A malformed setting therefore does not lengthen or
 * shorten the backoff; it removes it, exactly when the thing being retried is a
 * 429 or an overload. Same for the attempt count: `attempt <= NaN` is false on
 * the first pass, so the call would never be made at all.
 *
 * @param {any} value
 * @param {number} fallback
 * @returns {number}
 */
function finite(value, fallback) {
  if (value == null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Pure delay computation for a single attempt (no Retry-After).
 * Useful for tests and docs.
 *
 * @param {JitterStrategy} strategy
 * @param {number} attempt 0-based
 * @param {object} [opts]
 * @param {number} [opts.baseMs=200]
 * @param {number} [opts.maxDelayMs=30000]
 * @param {number} [opts.prevDelayMs] required for decorrelated continuity
 * @param {() => number} [opts.random]
 */
export function computeJitterDelay(strategy, attempt, opts = {}) {
  const baseMs = Math.max(1, finite(opts.baseMs, 200));
  const maxDelayMs = Math.max(baseMs, finite(opts.maxDelayMs, 30_000));
  const random = opts.random ?? Math.random;
  const a = Math.max(0, attempt | 0);
  const exp = Math.min(maxDelayMs, baseMs * 2 ** a);
  const prev = finite(opts.prevDelayMs, baseMs);
  const resolved = resolveJitterStrategy(strategy);

  let d;
  switch (resolved) {
    case "none":
      d = exp;
      break;
    case "equal": {
      const half = exp / 2;
      d = half + random() * half;
      break;
    }
    case "decorrelated": {
      const hi = Math.min(maxDelayMs, prev * 3);
      const lo = baseMs;
      d = lo >= hi ? hi : lo + random() * (hi - lo);
      break;
    }
    case "full":
    default:
      d = random() * exp;
      break;
  }
  return Math.min(maxDelayMs, Math.max(0, Math.floor(d)));
}

/**
 * Parse Retry-After header value into milliseconds from now.
 * Supports delta-seconds and HTTP-date (RFC 7231).
 *
 * @param {string | number | null | undefined} value
 * @param {number} [nowMs=Date.now()]
 * @returns {number | null} delay ms, or null if missing/invalid
 */
export function parseRetryAfterMs(value, nowMs = Date.now()) {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  if (!raw) return null;

  // Delta-seconds (most common for 429)
  if (/^\d+$/.test(raw)) {
    const sec = Number(raw);
    if (!Number.isFinite(sec) || sec < 0) return null;
    return Math.floor(sec * 1000);
  }

  // HTTP-date
  const when = Date.parse(raw);
  if (Number.isNaN(when)) return null;
  const delta = when - nowMs;
  if (delta <= 0) return 0;
  return Math.floor(delta);
}

/**
 * Extract Retry-After from an error or headers object.
 * Checks err.retryAfterMs, err.retryAfter, err.headers, err.response.headers.
 *
 * @param {any} err
 * @param {number} [nowMs]
 * @returns {number | null}
 */
export function getRetryAfterMs(err, nowMs = Date.now()) {
  if (!err) return null;
  if (typeof err.retryAfterMs === "number" && Number.isFinite(err.retryAfterMs)) {
    return Math.max(0, Math.floor(err.retryAfterMs));
  }
  if (err.retryAfter != null) {
    const parsed = parseRetryAfterMs(err.retryAfter, nowMs);
    if (parsed != null) return parsed;
  }
  const headers = err.headers || err.response?.headers || err.res?.headers;
  if (headers) {
    const v =
      headers["retry-after"] ??
      headers["Retry-After"] ??
      (typeof headers.get === "function" ? headers.get("retry-after") : null);
    const parsed = parseRetryAfterMs(v, nowMs);
    if (parsed != null) return parsed;
  }
  return null;
}

/**
 * @param {object} [opts]
 * @param {number} [opts.baseMs=200] initial delay scale
 * @param {number} [opts.maxDelayMs=30_000] hard cap
 * @param {JitterStrategy} [opts.strategy="full"]
 * @param {() => number} [opts.random] inject RNG (tests)
 * @param {boolean} [opts.respectRetryAfter=true]
 * @param {number} [opts.retryAfterJitterRatio=0.1] extra U(0, ratio*hint) on Retry-After
 */
export function createBackoff(opts = {}) {
  const baseMs = Math.max(1, finite(opts.baseMs, 200));
  const maxDelayMs = Math.max(baseMs, finite(opts.maxDelayMs, 30_000));
  const strategy = resolveJitterStrategy(opts.strategy ?? "full");
  const random = opts.random ?? Math.random;
  const respectRetryAfter = opts.respectRetryAfter !== false;
  // Not routed through finite(): a NaN ratio makes `retryAfterJitterRatio > 0`
  // false, which skips the jitter and returns the server hint untouched. That
  // is already the safe outcome, so a fallback here would change behaviour
  // without fixing anything.
  const retryAfterJitterRatio = Math.max(0, opts.retryAfterJitterRatio ?? 0.1);

  let prevDelay = baseMs;

  /**
   * Compute sleep ms for this attempt (0-based).
   * @param {number} attempt
   * @param {any} [err] optional error carrying Retry-After
   */
  function delayMs(attempt, err) {
    if (respectRetryAfter) {
      const ra = getRetryAfterMs(err);
      if (ra != null) {
        let d = ra;
        if (retryAfterJitterRatio > 0 && ra > 0) {
          d = ra + Math.floor(random() * ra * retryAfterJitterRatio);
        }
        d = Math.min(maxDelayMs, Math.max(0, d));
        prevDelay = d || baseMs;
        return d;
      }
    }

    const d = computeJitterDelay(strategy, attempt, {
      baseMs,
      maxDelayMs,
      prevDelayMs: prevDelay,
      random,
    });
    prevDelay = d || baseMs;
    return d;
  }

  function reset() {
    prevDelay = baseMs;
  }

  /**
   * Sleep for delayMs(attempt, err).
   * @param {number} attempt
   * @param {AbortSignal} [signal]
   * @param {any} [err]
   */
  function sleep(attempt, signal, err) {
    const ms = delayMs(attempt, err);
    if (ms <= 0) return Promise.resolve(0);
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(Object.assign(new Error("aborted"), { code: "ABORT_ERR" }));
        return;
      }
      const t = setTimeout(() => {
        signal?.removeEventListener?.("abort", onAbort);
        resolve(ms);
      }, ms);
      function onAbort() {
        clearTimeout(t);
        reject(Object.assign(new Error("aborted"), { code: "ABORT_ERR" }));
      }
      signal?.addEventListener?.("abort", onAbort, { once: true });
    });
  }

  return {
    delayMs,
    sleep,
    reset,
    baseMs,
    maxDelayMs,
    strategy,
    respectRetryAfter,
  };
}

/**
 * Classify errors that are worth retrying.
 * @param {any} err
 */
export function isTransientError(err) {
  if (!err) return false;
  if (err.code === "ABORT_ERR" || err.name === "AbortError") return false;

  const status = err.status ?? err.statusCode ?? err.httpStatus;
  // 408 timeout, 429 rate limit, 5xx server / overload (529 Anthropic overloaded)
  if (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 529
  ) {
    return true;
  }

  // Explicit Retry-After on any status → treat as retryable signal from server
  if (getRetryAfterMs(err) != null && status != null && status >= 400) {
    return true;
  }

  // Anthropic / OpenAI structured error bodies
  const errType = String(
    err.body?.error?.type || err.error?.type || err.type || ""
  ).toLowerCase();
  if (
    errType === "rate_limit_error" ||
    errType === "overloaded_error" ||
    errType === "api_error" ||
    errType === "timeout"
  ) {
    return true;
  }

  const msg = String(err.message || err).toLowerCase();
  if (
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("epipe") ||
    msg.includes("socket hang up") ||
    msg.includes("network") ||
    msg.includes("temporarily unavailable") ||
    msg.includes("rate limit") ||
    msg.includes("overloaded") ||
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("504") ||
    msg.includes("529")
  ) {
    return true;
  }

  const code = err.code;
  if (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "EPIPE" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN"
  ) {
    return true;
  }

  return false;
}

/**
 * Retry an async function with jittered backoff / Retry-After.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {object} [opts]
 * @param {number} [opts.retries=3] max retry attempts after the first try
 * @param {number} [opts.baseMs=200]
 * @param {number} [opts.maxDelayMs=30_000]
 * @param {JitterStrategy} [opts.strategy="full"]
 * @param {boolean} [opts.respectRetryAfter=true]
 * @param {number} [opts.retryAfterJitterRatio=0.1]
 * @param {(err: any, attempt: number) => boolean} [opts.shouldRetry] default isTransientError
 * @param {AbortSignal} [opts.signal]
 * @param {(info: object) => void} [opts.onRetry]
 * @returns {Promise<T>}
 */
export async function withBackoff(fn, opts = {}) {
  const retries = Math.max(0, finite(opts.retries, 3));
  const shouldRetry = opts.shouldRetry ?? isTransientError;
  const backoff = createBackoff({
    baseMs: opts.baseMs,
    maxDelayMs: opts.maxDelayMs,
    strategy: opts.strategy,
    random: opts.random,
    respectRetryAfter: opts.respectRetryAfter,
    retryAfterJitterRatio: opts.retryAfterJitterRatio,
  });
  const signal = opts.signal;
  const onRetry = opts.onRetry;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) {
      throw Object.assign(new Error("aborted"), { code: "ABORT_ERR" });
    }
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const canRetry = attempt < retries && shouldRetry(err);
      if (!canRetry) throw err;
      const ra = getRetryAfterMs(err);
      const waited = await backoff.sleep(attempt, signal, err);
      await Promise.resolve(
        onRetry?.({
          attempt: attempt + 1,
          retries,
          error: err,
          delayMs: waited,
          strategy: backoff.strategy,
          retryAfterMs: ra,
          usedRetryAfter: ra != null && backoff.respectRetryAfter,
        })
      );
    }
  }
  throw lastErr;
}

/**
 * Config helper: read agent/computer retry settings.
 * @param {object} [cfg]
 */
export function backoffOptsFromConfig(cfg = {}) {
  const r = cfg.retry || cfg.agent?.retry || {};
  return {
    retries: r.retries ?? 3,
    baseMs: r.baseMs ?? 200,
    maxDelayMs: r.maxDelayMs ?? 30_000,
    strategy: resolveJitterStrategy(r.strategy ?? "full"),
    respectRetryAfter: r.respectRetryAfter !== false,
    retryAfterJitterRatio: r.retryAfterJitterRatio ?? 0.1,
  };
}


/**
 * Pure exponential delay: base * 2^attempt, capped (no jitter).
 * @param {number} attempt 0-based
 * @param {{ baseMs?: number, maxDelayMs?: number }} [opts]
 * @returns {number}
 */
export function exponentialBackoffMs(attempt, opts = {}) {
  return computeJitterDelay("none", attempt, {
    baseMs: opts.baseMs ?? 200,
    maxDelayMs: opts.maxDelayMs ?? 30_000,
    random: () => 0,
  });
}

/**
 * Full-jitter exponential delay (AWS full jitter): U(0, min(max, base*2^attempt)).
 * Preferred default for clients and SSE reconnect.
 * @param {number} attempt 0-based
 * @param {{ baseMs?: number, maxDelayMs?: number, random?: () => number }} [opts]
 * @returns {number}
 */
export function fullJitterBackoffMs(attempt, opts = {}) {
  return computeJitterDelay("full", attempt, {
    baseMs: opts.baseMs ?? 200,
    maxDelayMs: opts.maxDelayMs ?? 30_000,
    random: opts.random ?? Math.random,
  });
}

/**
 * Decorrelated jitter (AWS): delay ~ U(base, min(max, 3 * prev)).
 * Stateful — pass prevDelayMs from the previous scheduled delay.
 *
 * @param {number} attempt 0-based (unused for magnitude; kept for API symmetry)
 * @param {{ baseMs?: number, maxDelayMs?: number, prevDelayMs?: number, random?: () => number }} [opts]
 * @returns {number}
 */
export function decorrelatedBackoffMs(attempt, opts = {}) {
  return computeJitterDelay("decorrelated", attempt, {
    baseMs: opts.baseMs ?? 200,
    maxDelayMs: opts.maxDelayMs ?? 30_000,
    prevDelayMs: opts.prevDelayMs ?? opts.baseMs ?? 200,
    random: opts.random ?? Math.random,
  });
}

/**
 * Run async fn with exponential backoff retries.
 * Alias of withBackoff using strategy "none" (pure exp) unless overridden.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {object} [opts] same as withBackoff; default strategy "full"
 * @returns {Promise<T>}
 */
/**
 * Pure exponential schedule helper: base * 2^attempt for attempts 0..n
 * @param {number} [n=5]
 * @param {object} [opts]
 * @returns {number[]}
 */
export function exponentialSchedule(n = 5, opts = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(exponentialBackoffMs(i, opts));
  }
  return out;
}

/**
 * Run async fn with exponential backoff retries.
 * Default strategy is pure exponential (`none`); pass strategy:"full" for jitter.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {object} [opts] same as withBackoff
 * @returns {Promise<T>}
 */
export async function withExponentialBackoff(fn, opts = {}) {
  const { strategy, ...rest } = opts;
  return withBackoff(fn, {
    ...rest,
    strategy: strategy ?? "none",
  });
}
