/**
 * Autonomy / smoke: lastDrain.channel must be http|ws|sse.
 */
import { normalizeStopChannel, STOP_CHANNELS } from "../cli/doctor-channel.mjs";

export function assertStopChannel(channel) {
  const c = normalizeStopChannel(channel);
  return {
    ok: STOP_CHANNELS.includes(c),
    channel: c,
    allowed: [...STOP_CHANNELS],
  };
}

export function assertLastDrainChannel(lastDrain) {
  if (!lastDrain) return { ok: true, skipped: true };
  return assertStopChannel(lastDrain.channel || lastDrain.drain?.channel);
}

export default { assertStopChannel, assertLastDrainChannel };
