/**
 * Live SSE attach — streams must go through the fanout registry.
 */
import { initSSE } from "./sse.mjs";
import { subscribeLiveSSE } from "./sse-fanout-registry.mjs";

export function initLiveSSE(res, opts = {}) {
  initSSE(res);
  const room = opts.room || opts.sessionId || opts.jobId || "default";
  const sub = subscribeLiveSSE(res, room, { hello: opts.hello !== false });
  return { room, ...sub };
}

export default { initLiveSSE };
