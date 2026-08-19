import { getAuditHmacFailTotal } from "./compact-audit-hmac.mjs";

export function renderAuditHmacFailLine() {
  return `xclaw_gossip_audit_hmac_fail_total ${getAuditHmacFailTotal()}\n`;
}

export default { renderAuditHmacFailLine };
