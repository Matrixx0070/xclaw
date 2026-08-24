/**
 * Swarm Rate Limit Middleware
 * Token bucket rate limiting per API key
 */
import { TokenBucket } from "../../swarm/utils.mjs";

const buckets = new Map();

export function swarmRateLimit(req, res, next) {
  const swarm = req.swarm;
  if (!swarm?.authenticated) return next();

  const key = swarm.key;
  const maxRequests = swarm.tier === "premium" ? 1000 : 100;
  const windowMs = 60000;

  if (!buckets.has(key)) {
    buckets.set(key, new TokenBucket(maxRequests, maxRequests / (windowMs / 1000)));
  }

  const bucket = buckets.get(key);
  if (!bucket.consume(1)) {
    const waitMs = bucket.waitTime(1);
    return res.status(429).json({
      error: "Rate limit exceeded",
      retryAfter: Math.ceil(waitMs / 1000),
    });
  }

  next();
}
