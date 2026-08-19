/**
 * Deferred per-region seq compact queue with lease.
 */
import { compactSeqLedger } from "./gossip-seq.mjs";
import {
  acquireCompactLease,
  releaseCompactLease,
  renewCompactLease,
} from "./compact-lease.mjs";

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
      const lease = acquireCompactLease(cfg, region);
      if (!lease.ok) {
        results.push({ ok: false, skipped: true, ...lease });
        pending.add(region);
        continue;
      }
      try {
        renewCompactLease(cfg, region, { owner: lease.owner });
        results.push(
          compactSeqLedger({ ...cfg, _seqRegion: region === "local" ? null : region })
        );
      } finally {
        releaseCompactLease(cfg, region, { owner: lease.owner });
      }
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
