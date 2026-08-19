import { compactLeasesHeld } from "./compact-lease.mjs";

export function renderCompactLeaseLine() {
  return `xclaw_gossip_compact_lease_held ${compactLeasesHeld()}\n`;
}

export default { renderCompactLeaseLine };
