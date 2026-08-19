/**
 * Redis soak lease backend — SET NX PX + renew.
 */
export async function acquireSoakLeaseRedis(jobId, opts = {}) {
  const redis = opts.redis;
  if (!redis || typeof redis.set !== "function") {
    return { ok: false, code: "REDIS_UNAVAILABLE", backend: "redis" };
  }
  const owner = opts.owner || `soak-${process.pid}`;
  const ttl = Number(
    opts.ttlMs ?? process.env.XCLAW_SOAK_LEASE_TTL_MS ?? 30_000
  );
  const key = `xclaw:soak:lease:${jobId}`;
  try {
    const r = await redis.set(key, owner, { NX: true, PX: ttl });
    if (r === "OK" || r === true) {
      return { ok: true, owner, jobId: String(jobId), backend: "redis", ttl };
    }
    const cur = await redis.get(key);
    return {
      ok: false,
      code: "LEASE_HELD",
      owner: cur || "unknown",
      jobId: String(jobId),
      backend: "redis",
    };
  } catch (e) {
    return {
      ok: false,
      code: "REDIS_ERROR",
      error: String(e.message || e),
      backend: "redis",
    };
  }
}

export async function renewSoakLeaseRedis(jobId, opts = {}) {
  const redis = opts.redis;
  if (!redis) return { ok: false, code: "REDIS_UNAVAILABLE", backend: "redis" };
  const owner = opts.owner || `soak-${process.pid}`;
  const key = `xclaw:soak:lease:${jobId}`;
  const ttl = Number(opts.ttlMs ?? 30_000);
  try {
    const cur = await redis.get(key);
    if (cur !== owner)
      return { ok: false, code: "LEASE_NOT_HELD", backend: "redis" };
    if (typeof redis.pexpire === "function") await redis.pexpire(key, ttl);
    else await redis.set(key, owner, { PX: ttl });
    return {
      ok: true,
      owner,
      jobId: String(jobId),
      backend: "redis",
      renewed: true,
    };
  } catch (e) {
    return { ok: false, code: "REDIS_ERROR", error: String(e.message || e) };
  }
}

export async function releaseSoakLeaseRedis(jobId, opts = {}) {
  const redis = opts.redis;
  if (!redis) return { ok: false, code: "REDIS_UNAVAILABLE", backend: "redis" };
  const owner = opts.owner || `soak-${process.pid}`;
  const key = `xclaw:soak:lease:${jobId}`;
  try {
    const cur = await redis.get(key);
    if (cur && cur !== owner) {
      return {
        ok: false,
        code: "LEASE_NOT_OWNER",
        owner: cur,
        backend: "redis",
      };
    }
    await redis.del(key);
    return {
      ok: true,
      released: true,
      jobId: String(jobId),
      backend: "redis",
    };
  } catch (e) {
    return { ok: false, code: "REDIS_ERROR", error: String(e.message || e) };
  }
}

export default {
  acquireSoakLeaseRedis,
  renewSoakLeaseRedis,
  releaseSoakLeaseRedis,
};
