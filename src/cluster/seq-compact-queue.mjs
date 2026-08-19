/**
 * Deferred per-region seq compact queue.
 */
import { compactSeqLedger } from "./gossip-seq.mjs";

const pending = new Set();
let draining = false;

export function enqueueCompact(region = "local") {
  pending.add(region || "local");
  return pending.size;
}

export function compactQueueDepth() {
  return pending.size;
}

export function resetCompactQueue() {
  pending.clear();
  draining = false;
}

export function drainCompactQueue(cfg = {}) {
  if (draining) return { ok: true, skipped: true, depth: pending.size };
  draining = true;
  const regions = [...pending];
  pending.clear();
  const results = [];
  try {
    for (const region of regions) {
      results.push(
        compactSeqLedger({ ...cfg, _seqRegion: region === "local" ? null : region })
      );
    }
  } finally {
    draining = false;
  }
  return { ok: true, drained: regions.length, results, depth: pending.size };
}

export default {
  enqueueCompact,
  compactQueueDepth,
  drainCompactQueue,
  resetCompactQueue,
};
