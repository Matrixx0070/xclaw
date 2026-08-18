/**
 * Live SSE attach — streams must go through the fanout registry.
 * Rooms are prefix-scoped: agent:<id>, swarm:<id>, webchat:<id>.
 */
import { initSSE, createStreamWriter } from "./sse.mjs";
import { subscribeLiveSSE } from "./sse-fanout-registry.mjs";

export function liveRoomName(opts = {}) {
  const prefix = opts.prefix || opts.kind || null;
  const id = opts.room || opts.sessionId || opts.jobId || opts.swarmId || null;
  if (prefix && id) return `${prefix}:${id}`;
  if (prefix) return String(prefix);
  if (id) return String(id);
  return "default";
}

export function initLiveSSE(res, opts = {}) {
  initSSE(res);
  const room = liveRoomName(opts);
  const sub = subscribeLiveSSE(res, room, { hello: opts.hello !== false });
  return { room, ...sub };
}

export function createLiveStreamWriter(req, res, opts = {}) {
  const writer = createStreamWriter(req, res, opts);
  const room = liveRoomName(opts);
  const sub = subscribeLiveSSE(res, room, { hello: false });
  return { ...writer, room, unsubscribe: sub.unsubscribe };
}

export default { initLiveSSE, createLiveStreamWriter, liveRoomName };
