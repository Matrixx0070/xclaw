/**
 * Workspace quota events — soft warn / hard refuse on WS+SSE.
 */

async function defaultPublish(room, event, data) {
  const { publishLiveSSE } = await import("../gateway/sse-fanout-registry.mjs");
  return publishLiveSSE(room, event, data);
}

function defaultBroadcast() {
  return globalThis.__xclawWsBroadcast;
}

export function emitQuotaEvent(payload = {}, hubs = {}) {
  const phase = payload.phase || "soft";
  const sseName = phase === "hard" ? "quota_hard" : "quota_soft";
  const event = {
    type: "quota",
    phase,
    at: new Date().toISOString(),
    ...payload,
    phase,
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
      sse = publish(payload.room || "security", sseName, event);
    } catch (err) {
      sse = { ok: false, error: err.message };
    }
    return { event, ws, sse };
  }
  sse = defaultPublish(payload.room || "security", sseName, event);
  return { event, ws, sse };
}

export function emitQuotaSoftWarn(payload = {}, hubs = {}) {
  return emitQuotaEvent({ ...payload, phase: "soft" }, hubs);
}

export function emitQuotaHard(payload = {}, hubs = {}) {
  return emitQuotaEvent({ ...payload, phase: "hard" }, hubs);
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

export function maybeEmitQuotaHard(result, extra = {}, hubs = {}) {
  if (result?.ok !== false && !result?.hard) return { skipped: true, result };
  return {
    skipped: false,
    ...emitQuotaHard(
      {
        reason: result.code || "WORKSPACE_QUOTA_EXCEEDED",
        message: result.message,
        quota: result.quota || result,
        ...extra,
      },
      hubs
    ),
  };
}

export default {
  emitQuotaEvent,
  emitQuotaSoftWarn,
  emitQuotaHard,
  maybeEmitQuotaSoft,
  maybeEmitQuotaHard,
};
