/**
 * Control-plane channel enum for kill-switch lastDrain audit.
 */
export const STOP_CHANNELS = Object.freeze(["http", "ws", "sse"]);

/**
 * @param {unknown} raw
 * @returns {"http"|"ws"|"sse"|"unknown"}
 */
export function normalizeStopChannel(raw) {
  if (raw == null || raw === "") return "http";
  const c = String(raw).toLowerCase().trim();
  if (c === "http" || c === "https") return "http";
  if (c === "ws" || c === "websocket") return "ws";
  if (c === "sse" || c === "event-source" || c === "eventsource") return "sse";
  return "unknown";
}

export function isKnownStopChannel(raw) {
  return STOP_CHANNELS.includes(normalizeStopChannel(raw));
}

export default { STOP_CHANNELS, normalizeStopChannel, isKnownStopChannel };
