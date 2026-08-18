/**
 * Doctor ops: attach channel enum to lastDrain check.
 */
import { STOP_CHANNELS, normalizeStopChannel } from "./doctor-channel.mjs";

export function enrichOpsStopChannels(checks = []) {
  const last = (checks || []).find((c) => c?.id === "security.killSwitch.lastDrain");
  if (!last) return checks;
  const ch = normalizeStopChannel(last.detail?.channel || last.detail?.drain?.channel);
  last.detail = { ...(last.detail || {}), channel: ch, channels: [...STOP_CHANNELS] };
  return checks;
}

export function stopChannelEnum() {
  return [...STOP_CHANNELS];
}

export default { enrichOpsStopChannels, stopChannelEnum };
