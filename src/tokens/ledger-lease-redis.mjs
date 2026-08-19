/**
 * Redis lease adapter skeleton — same interface as ledger-lease.mjs.
 * Activate with XCLAW_LEDGER_LEASE_BACKEND=redis and cfg.redis client.
 */
import { incLeaseMetric } from "./lease-metrics.mjs";

export function redisEnabled(cfg = {}) {
  return (
    process.env.XCLAW_LEDGER_LEASE_BACKEND === "redis" ||
    cfg?.tokens?.ledgerLeaseBackend === "redis"
  );
}

function key(cfg = {}) {
  const account = cfg?.tokens?.account || "default";
  const day = new Date().toISOString().slice(0, 10);
  return `xclaw:ledger:lease:${account}:${day}`;
}

export async function acquireLease(cfg = {}, { owner = null, ttlMs = 30_000 } = {}) {
  const id = owner || `gw-${process.pid}`;
  const client = cfg.redis || cfg.redisClient;
  if (!client || typeof client.set !== "function") {
    incLeaseMetric("lease_backend_error_total");
    return { ok: false, reason: "redis_unavailable", code: "LEASE_BACKEND_ERROR" };
  }
  try {
    const k = key(cfg);
    const r = await client.set(k, id, "PX", ttlMs, "NX");
    if (r === "OK" || r === true) {
      incLeaseMetric("lease_acquire_total");
      return { ok: true, owner: id, expiresAt: Date.now() + ttlMs, backend: "redis" };
    }
    incLeaseMetric("lease_held_total");
    return { ok: false, reason: "lease_held", backend: "redis" };
  } catch (e) {
    incLeaseMetric("lease_backend_error_total");
    return {
      ok: false,
      reason: "redis_error",
      code: "LEASE_BACKEND_ERROR",
      error: String(e.message || e),
    };
  }
}

export async function renewLease(cfg = {}, { owner = null, ttlMs = 30_000 } = {}) {
  const client = cfg.redis || cfg.redisClient;
  if (!client) {
    return { ok: false, reason: "redis_unavailable", code: "LEASE_BACKEND_ERROR" };
  }
  try {
    const k = key(cfg);
    const cur = await client.get(k);
    if (cur !== owner) return { ok: false, reason: "not_owner" };
    await client.pexpire(k, ttlMs);
    incLeaseMetric("lease_renew_total");
    return { ok: true, owner, expiresAt: Date.now() + ttlMs, backend: "redis" };
  } catch (e) {
    incLeaseMetric("lease_backend_error_total");
    return { ok: false, code: "LEASE_BACKEND_ERROR", error: String(e.message || e) };
  }
}

export async function releaseLease(cfg = {}, { owner = null } = {}) {
  const client = cfg.redis || cfg.redisClient;
  if (!client) return { ok: false, code: "LEASE_BACKEND_ERROR" };
  try {
    const k = key(cfg);
    const cur = await client.get(k);
    if (owner && cur !== owner) return { ok: false, reason: "not_owner" };
    await client.del(k);
    incLeaseMetric("lease_release_total");
    return { ok: true, backend: "redis" };
  } catch (e) {
    return { ok: false, code: "LEASE_BACKEND_ERROR", error: String(e.message || e) };
  }
}

export default { acquireLease, renewLease, releaseLease, redisEnabled };
