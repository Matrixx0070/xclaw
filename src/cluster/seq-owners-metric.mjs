import { readSeqLedger, ownerCount, shardOwnerCounts } from "./gossip-seq.mjs";

export function seqOwnersGauge(cfg = {}) {
  return ownerCount(readSeqLedger(cfg));
}

export function renderSeqOwnersLine(cfg = {}) {
  const shards = shardOwnerCounts(cfg);
  if (!Object.keys(shards).length) {
    return `xclaw_gossip_seq_owners ${seqOwnersGauge(cfg)}\n`;
  }
  return (
    Object.entries(shards)
      .map(([region, n]) => `xclaw_gossip_seq_owners{region="${region}"} ${n}`)
      .join("\n") + "\n"
  );
}

export default { seqOwnersGauge, renderSeqOwnersLine };
