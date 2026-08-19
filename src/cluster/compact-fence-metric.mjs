import { readFence } from "./compact-fence.mjs";

export function renderCompactFenceLine(cfg = {}, region = "local") {
  return `xclaw_gossip_compact_fence{region="${region}"} ${Number(readFence(cfg, region).fence) || 0}\n`;
}

export default { renderCompactFenceLine };
