/**
 * Soft-band workspace quota — warn on WS/SSE before hard refuse.
 */

async function defaultPublish(room, event, data) {
  const { publishLiveSSE } = await import("../gateway/sse-fanout-registry.mjs");
  return publishLiveSSE(room, event, data);
}

function defaultBroadcast() {
  return globalThis.__xclawWsBroadcast;
}

export function emitQuotaSoftWarn(payload = {}, hubs = {}) {
  const event = {
    type: "quota",
    phase: "soft",
    at: new Date().toISOString(),
    ...payload,
  };
  let ws = null;
  let sse = null;
  try {
    const broadcast = hubs.broadcast || defaultBroadcast();
    if (typeof broadcast === "function") {
      ws = broadcast("security", event) ?? { ok: true };
    }
  } catch (err) {
    ws = { ok: false, error: err.message };
  }
  const publish = hubs.publish;
  if (typeof publish === "function") {
    try {
      sse = publish(payload.room || "security", "quota_soft", event);
    } catch (err) {
      sse = { ok: false, error: err.message };
    }
    return { event, ws, sse };
  }
  sse = defaultPublish(payload.room || "security", "quota_soft", event);
  return { event, ws, sse };
}

export function maybeEmitQuotaSoft(result, extra = {}, hubs = {}) {
  if (!result?.soft) return { skipped: true, result };
  return {
    skipped: false,
    ...emitQuotaSoftWarn(
      {
        reason: result.code || "WORKSPACE_QUOTA_SOFT",
        message: result.message,
        quota: result.quota || result,
        ...extra,
      },
      hubs
    ),
  };
}

export default { emitQuotaSoftWarn, maybeEmitQuotaSoft };
