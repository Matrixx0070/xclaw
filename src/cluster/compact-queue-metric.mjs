import { compactQueueDepth } from "./seq-compact-queue.mjs";

export function renderCompactQueueLine() {
  return `xclaw_gossip_compact_queue ${compactQueueDepth()}\n`;
}

export default { renderCompactQueueLine };
