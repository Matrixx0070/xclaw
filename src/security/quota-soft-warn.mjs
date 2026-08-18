/**
 * Soft-band workspace quota — warn on WS/SSE before hard refuse.
 */

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
    const broadcast = hubs.broadcast || globalThis.__xclawWsBroadcast;
    if (typeof broadcast === "function") {
      ws = broadcast("security", event);
    }
  } catch (err) {
    ws = { ok: false, error: err.message };
  }
  try {
    const publish = hubs.publish;
    if (typeof publish === "function") {
      sse = publish(payload.room || "security", "quota_soft", event);
    }
  } catch (err) {
    sse = { ok: false, error: err.message };
  }
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
