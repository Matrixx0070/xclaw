/**
 * Redis compact lease — SET NX PX, owner-checked release.
 */
export function redisLeaseEnabled(cfg = {}) {
  return (
    process.env.XCLAW_COMPACT_LEASE_BACKEND === "redis" ||
    cfg?.cluster?.compactLeaseBackend === "redis"
  );
}

export function leaseKey(region = "local") {
  return `xclaw:compact:${region || "local"}`;
}

export async function acquireRedisLease(cfg = {}, region = "local", { owner = null } = {}) {
  const prod =
    cfg.profile === "prod" ||
    cfg.profile === "strict" ||
    cfg.cluster?.requireRedisLease === true;
  const redis = cfg.redis || cfg.redisClient;
  if (!redis || typeof redis.set !== "function") {
    return { ok: false, code: "REDIS_UNAVAILABLE", failClosed: prod };
  }
  const id = owner || cfg?.cluster?.owner || `gw-${process.pid}`;
  const ttl = Number(cfg?.cluster?.compactLeaseTtlMs ?? 15_000);
  try {
    const r = await redis.set(leaseKey(region), id, "PX", ttl, "NX");
    if (r === "OK" || r === true) return { ok: true, owner: id, backend: "redis", region };
    return { ok: false, code: "LEASE_HELD", backend: "redis", region };
  } catch (e) {
    return {
      ok: false,
      code: "REDIS_ERROR",
      error: String(e.message || e),
      failClosed: prod,
    };
  }
}

export async function releaseRedisLease(cfg = {}, region = "local", { owner = null } = {}) {
  const redis = cfg.redis || cfg.redisClient;
  if (!redis) return { ok: false, code: "REDIS_UNAVAILABLE" };
  const id = owner || cfg?.cluster?.owner || `gw-${process.pid}`;
  try {
    const cur = typeof redis.get === "function" ? await redis.get(leaseKey(region)) : null;
    if (cur && cur !== id) return { ok: false, code: "LEASE_NOT_OWNER" };
    if (typeof redis.del === "function") await redis.del(leaseKey(region));
    return { ok: true, backend: "redis", region };
  } catch (e) {
    return { ok: false, code: "REDIS_ERROR", error: String(e.message || e) };
  }
}

export function leaseBackend(cfg = {}) {
  return redisLeaseEnabled(cfg) ? "redis" : "file";
}

export default {
  acquireRedisLease,
  releaseRedisLease,
  redisLeaseEnabled,
  leaseBackend,
};
