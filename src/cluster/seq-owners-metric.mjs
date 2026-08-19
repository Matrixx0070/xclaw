import { readSeqLedger, ownerCount } from "./gossip-seq.mjs";

export function seqOwnersGauge(cfg = {}) {
  return ownerCount(readSeqLedger(cfg));
}

export function renderSeqOwnersLine(cfg = {}) {
  return `xclaw_gossip_seq_owners ${seqOwnersGauge(cfg)}\n`;
}

export default { seqOwnersGauge, renderSeqOwnersLine };
