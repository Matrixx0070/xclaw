/**
 * Process-wide SSE fanout registry for session kill-switch.
 */
import { createSSEFanout } from "./sse-fanout.mjs";

let hub = null;

export function getSSEFanout() {
  if (!hub) hub = createSSEFanout();
  return hub;
}

export function setSSEFanout(next) {
  hub = next;
  return hub;
}

export function closeAllSSEFanout(reason = "kill_all") {
  if (!hub) return { rooms: 0, subscribers: 0, reason, idle: true };
  return hub.closeAll(reason);
}

export default { getSSEFanout, setSSEFanout, closeAllSSEFanout };
