/**
 * In-memory rate limit for /cluster/reserve per peer key.
 */
const buckets = new Map();

export function rateLimitKey(req) {
  return (
    req?.headers?.["x-xclaw-peer-id"] ||
    req?.socket?.remoteAddress ||
    req?.headers?.["x-forwarded-for"] ||
    "unknown"
  );
}

export function checkRateLimit(key, { limit = 30, windowMs = 60_000 } = {}) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.windowStart > windowMs) {
    b = { windowStart: now, count: 0 };
    buckets.set(key, b);
  }
  b.count += 1;
  if (b.count > limit) {
    return { ok: false, code: "CLUSTER_RATE_LIMIT", limit, windowMs, count: b.count };
  }
  return { ok: true, remaining: limit - b.count };
}

export function resetRateLimits() {
  buckets.clear();
}

export default { checkRateLimit, rateLimitKey, resetRateLimits };
