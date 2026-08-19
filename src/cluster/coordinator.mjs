/**
 * Cluster coordinator — followers proxy reserve to primary with generation fence.
 */
import { reserveUsdAsync } from "../tokens/swarm-ledger.mjs";
import { bumpGeneration, acceptGeneration, readGeneration } from "./generation.mjs";

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
    if (j && j.generation != null) {
      const acc = acceptGeneration(cfg, j.generation);
      if (!acc.ok) return { ok: false, ...acc, upstream: j };
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
  const gen = readGeneration(cfg);
  const result = await reserveUsdAsync(cfg, body);
  return { ...result, generation: gen.generation || 0 };
}

export function claimCoordinator(cfg, { owner = null } = {}) {
  return bumpGeneration(cfg, { owner });
}

export default {
  proxyReserve,
  handleClusterReserve,
  isCoordinator,
  coordinatorUrl,
  claimCoordinator,
};
