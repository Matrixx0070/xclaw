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
  if (typeof hub.closeAll === "function") return hub.closeAll(reason);
  const st = hub.stats?.() || {};
  hub.clear?.();
  return { reason, rooms: Object.keys(st.rooms || {}).length, subscribers: 0, fallback: true };
}

export function subscribeLiveSSE(res, room, opts = {}) {
  return getSSEFanout().subscribe(room || "default", res, opts);
}

export function publishLiveSSE(room, event, data) {
  return getSSEFanout().publish(room || "default", event, data);
}

export default {
  getSSEFanout,
  setSSEFanout,
  closeAllSSEFanout,
  subscribeLiveSSE,
  publishLiveSSE,
};
