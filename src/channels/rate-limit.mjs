/**
 * Simple per-peer inbound rate limiter for channels.
 */
export function createRateLimiter(opts = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 20;
  const hits = new Map(); // key -> number[] timestamps

  function allow(key) {
    const k = String(key);
    const now = Date.now();
    let arr = hits.get(k) || [];
    arr = arr.filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      hits.set(k, arr);
      return { ok: false, remaining: 0, retryAfterMs: windowMs - (now - arr[0]) };
    }
    arr.push(now);
    hits.set(k, arr);
    return { ok: true, remaining: max - arr.length };
  }

  function reset(key) {
    if (key == null) hits.clear();
    else hits.delete(String(key));
  }

  return { allow, reset, windowMs, max };
}


/** Stable code for channel / agent consumers */
export const RATE_LIMITED = "RATE_LIMITED";
