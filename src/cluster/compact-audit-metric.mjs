import { countAuditLines } from "./compact-audit.mjs";

export function renderAuditLines(cfg = {}) {
  return `xclaw_gossip_compact_audit_lines ${countAuditLines(cfg)}\n`;
}

export default { renderAuditLines };
