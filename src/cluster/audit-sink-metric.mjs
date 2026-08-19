import { getSinkFailTotal } from "./audit-sink.mjs";

export function renderSinkFailLine() {
  return `xclaw_gossip_audit_sink_fail_total ${getSinkFailTotal()}\n`;
}

export default { renderSinkFailLine };
