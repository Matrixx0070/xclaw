import { acquireCompactLease, releaseCompactLease } from "./compact-lease.mjs";
import {
  acquireRedisLease,
  releaseRedisLease,
  redisLeaseEnabled,
  leaseBackend,
} from "./compact-lease-redis.mjs";

export async function acquireLease(cfg, region, opts) {
  if (redisLeaseEnabled(cfg)) return acquireRedisLease(cfg, region, opts);
  return acquireCompactLease(cfg, region, opts);
}

export async function releaseLease(cfg, region, opts) {
  if (redisLeaseEnabled(cfg)) return releaseRedisLease(cfg, region, opts);
  return releaseCompactLease(cfg, region, opts);
}

export { leaseBackend, redisLeaseEnabled };
