import { cursorLeasesHeld } from "./audit-cursor-lease.mjs";

export function renderCursorLeaseLine() {
  return `xclaw_gossip_audit_cursor_lease_held ${cursorLeasesHeld()}\n`;
}

export default { renderCursorLeaseLine };
