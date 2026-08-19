/**
 * On gateway start, claim coordinator fence (file generation or etcd).
 */
import { isCoordinator, claimCoordinator } from "./coordinator.mjs";
import { etcdEnabled, campaign } from "./etcd-election.mjs";

export function claimOnBoot(cfg = {}) {
  if (!isCoordinator(cfg)) return { claimed: false, reason: "not_coordinator" };
  const prod =
    cfg.profile === "prod" ||
    cfg.profile === "strict" ||
    cfg.cluster?.requireAuth === true;
  if (etcdEnabled(cfg)) {
    return {
      claimed: false,
      pending: "etcd",
      code: prod ? "ETCD_SYNC_BOOT" : "ETCD_PENDING",
      failClosed: prod,
    };
  }
  try {
    const gen = claimCoordinator(cfg, { owner: cfg?.cluster?.owner || `gw-${process.pid}` });
    return { claimed: true, ...gen };
  } catch (e) {
    return { claimed: false, error: String(e.message || e) };
  }
}

export async function claimOnBootAsync(cfg = {}) {
  if (!isCoordinator(cfg)) return { claimed: false, reason: "not_coordinator" };
  const prod =
    cfg.profile === "prod" ||
    cfg.profile === "strict" ||
    cfg.cluster?.requireAuth === true;
  if (etcdEnabled(cfg)) {
    const r = await campaign(cfg, { owner: cfg?.cluster?.owner || `gw-${process.pid}` });
    if (!r.ok && prod) {
      return { claimed: false, failClosed: true, ...r };
    }
    if (r.ok) {
      try {
        const gen = claimCoordinator(cfg, { owner: r.owner });
        return { claimed: true, backend: "etcd", ...gen };
      } catch {
        return { claimed: true, backend: "etcd", ...r };
      }
    }
    return { claimed: false, ...r };
  }
  return claimOnBoot(cfg);
}

export default { claimOnBoot, claimOnBootAsync };
