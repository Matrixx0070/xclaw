import { leaseBackend } from "./compact-lease-redis.mjs";

export function renderLeaseBackendLine(cfg = {}) {
  const b = leaseBackend(cfg);
  return `xclaw_gossip_compact_lease_backend{backend="${b}"} 1\n`;
}

export default { renderLeaseBackendLine };
