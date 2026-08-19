import { getIdempotentHitTotal } from "./audit-s3-idempotent.mjs";

export function renderIdempotentHitLine() {
  return `xclaw_gossip_audit_s3_idempotent_hit ${getIdempotentHitTotal()}\n`;
}

export default { renderIdempotentHitLine };
