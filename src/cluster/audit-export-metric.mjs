import { getAuditExportTotal } from "./audit-siem.mjs";

export function renderAuditExportLine() {
  return `xclaw_gossip_audit_export_total ${getAuditExportTotal()}\n`;
}

export default { renderAuditExportLine };
