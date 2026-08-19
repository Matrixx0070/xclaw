/**
 * Autonomy smoke: assert lastDrain.channel ∈ {http,ws,sse}.
 */
import { assertLastDrainChannel } from "./stop-channel-assert.mjs";
import { getLastDrain } from "../gateway/last-drain.mjs";

export function autonomyStopChannelCheck(opts = {}) {
  const last = opts.lastDrain || getLastDrain();
  const r = assertLastDrainChannel(last);
  return {
    name: "stop_channel_enum",
    ok: r.ok !== false,
    channel: r.channel || null,
    skipped: Boolean(r.skipped),
    allowed: r.allowed || ["http", "ws", "sse"],
  };
}

export default { autonomyStopChannelCheck };
