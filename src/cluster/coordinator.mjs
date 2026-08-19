/**
 * Cluster coordinator stub — followers proxy reserve to primary.
 */
import { reserveUsdAsync } from "../tokens/swarm-ledger.mjs";

export function coordinatorUrl(cfg = {}) {
  return (
    cfg?.cluster?.coordinatorUrl ||
    process.env.XCLAW_COORDINATOR_URL ||
    null
  );
}

export function isCoordinator(cfg = {}) {
  if (cfg?.cluster?.role === "coordinator") return true;
  if (process.env.XCLAW_CLUSTER_ROLE === "coordinator") return true;
  return !coordinatorUrl(cfg);
}

export async function proxyReserve(cfg, opts = {}) {
  const url = coordinatorUrl(cfg);
  if (!url || isCoordinator(cfg)) {
    return reserveUsdAsync(cfg, opts);
  }
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/cluster/reserve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { ok: false, code: "COORDINATOR_ERROR", status: r.status, ...j };
    }
    return j;
  } catch (e) {
    return {
      ok: false,
      code: "COORDINATOR_UNREACHABLE",
      message: String(e.message || e),
    };
  }
}

export async function handleClusterReserve(cfg, body = {}) {
  if (!isCoordinator(cfg)) {
    return { ok: false, code: "NOT_COORDINATOR" };
  }
  return reserveUsdAsync(cfg, body);
}

export default { proxyReserve, handleClusterReserve, isCoordinator, coordinatorUrl };
