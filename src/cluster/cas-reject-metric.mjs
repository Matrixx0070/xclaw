import { getCasRejectTotal } from "./compact-cas.mjs";

export function renderCasRejectLine() {
  return `xclaw_gossip_cas_reject_total ${getCasRejectTotal()}\n`;
}

export default { renderCasRejectLine };
