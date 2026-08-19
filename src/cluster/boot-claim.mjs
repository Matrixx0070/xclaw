/**
 * On gateway start, claim coordinator fence if role=coordinator.
 */
import { isCoordinator, claimCoordinator } from "./coordinator.mjs";

export function claimOnBoot(cfg = {}) {
  if (!isCoordinator(cfg)) return { claimed: false, reason: "not_coordinator" };
  try {
    const gen = claimCoordinator(cfg, { owner: cfg?.cluster?.owner || `gw-${process.pid}` });
    return { claimed: true, ...gen };
  } catch (e) {
    return { claimed: false, error: String(e.message || e) };
  }
}

export default { claimOnBoot };
