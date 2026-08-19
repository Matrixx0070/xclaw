/**
 * Server-Sent Events helpers with safe writes on dropped connections.
 */
import { redactEvent } from "../security/redact-secrets.mjs";

/**
 * @param {import('http').ServerResponse} res
 * @returns {boolean}
 */
export function isSSEOpen(res) {
  return Boolean(res && !res.writableEnded && !res.destroyed && res.writable !== false);
}

export function initSSE(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Powered-By": "XClaw-Gateway",
  });
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  safeWrite(res, ": connected\n\n");
}

/**
 * @returns {boolean} false if connection is gone
 */
export function safeWrite(res, chunk) {
  if (!isSSEOpen(res)) return false;
  try {
    res.write(chunk);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write one SSE event. Returns false if the client is gone.
 */
export function sendSSE(res, event, data, id) {
  if (!isSSEOpen(res)) return false;
  let out = "";
  if (id != null) out += `id: ${id}\n`;
  if (event) out += `event: ${event}\n`;
  const safe = typeof data === "string" ? redactEvent(data) : redactEvent(data);
  const payload = typeof safe === "string" ? safe : JSON.stringify(safe);
  for (const line of payload.split("\n")) {
    out += `data: ${line}\n`;
  }
  out += "\n";
  return safeWrite(res, out);
}

export function closeSSE(res, { skipDone = false } = {}) {
  if (!isSSEOpen(res)) return;
  if (!skipDone) sendSSE(res, "done", { ok: true });
  try {
    res.end();
  } catch {
    /* already closed */
  }
}

/**
 * Bind request/response lifecycle to an AbortController.
 * Aborts when the client drops (close / error / aborted).
 * @returns {() => void} cleanup (remove listeners + clear heartbeat)
 */
export function isAbortError(err, signal) {
  if (signal?.aborted) return true;
  if (!err) return false;
  if (err.name === "AbortError") return true;
  const msg = String(err.message || err);
  return /abort/i.test(msg) || msg === "sse_client_gone";
}

export function bindSSEAbort(req, res, controller, { heartbeatMs = 15000 } = {}) {
  let cleaned = false;
  const abort = (reason) => {
    if (cleaned) return;
    if (!controller.signal.aborted) {
      const err =
        reason instanceof Error
          ? reason
          : new Error(typeof reason === "string" ? reason : "sse_client_gone");
      try {
        controller.abort(err);
      } catch {
        try {
          controller.abort();
        } catch {
          /* */
        }
      }
    }
  };

  const onClose = () => abort(new Error("client_close"));
  const onReqError = () => abort(new Error("req_error"));
  const onResError = () => abort(new Error("res_error"));
  const onAborted = () => abort(new Error("req_aborted"));

  req.on("close", onClose);
  req.on("error", onReqError);
  req.on("aborted", onAborted);
  res.on("close", onClose);
  res.on("error", onResError);

  const heartbeat = setInterval(() => {
    if (!isSSEOpen(res)) {
      abort(new Error("heartbeat_dead"));
      return;
    }
    if (!safeWrite(res, ": ping\n\n")) {
      abort(new Error("heartbeat_write_failed"));
    }
  }, heartbeatMs);

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(heartbeat);
    req.off("close", onClose);
    req.off("error", onReqError);
    req.off("aborted", onAborted);
    res.off("close", onClose);
    res.off("error", onResError);
  };

  // If already aborted/closed when binding
  if (req.aborted || res.writableEnded || res.destroyed) {
    abort(new Error("already_gone"));
    cleanup();
  }

  return cleanup;
}


/**
 * Prefer NDJSON when Accept (or ?format=) asks for it.
 * @param {import('http').IncomingMessage} req
 * @returns {boolean}
 */
export function prefersNdjson(req) {
  const q = req.url || "";
  if (/[?&]format=ndjson\b/i.test(q)) return true;
  const accept = String(req.headers?.accept || "");
  if (/application\/x-ndjson/i.test(accept)) return true;
  if (/application\/ndjson/i.test(accept)) return true;
  if (/application\/jsonl/i.test(accept)) return true;
  return false;
}

/**
 * Dual writer: SSE (default) or NDJSON line stream based on Accept / ?format=ndjson.
 *
 * Heartbeat (both modes):
 * - Starts with the writer (default every 15s)
 * - SSE: comment line `: ping\n\n` (EventSource-safe, ignored by most parsers)
 * - NDJSON: `{"event":"ping","at":...}\n`
 * - Failed write or closed socket → optional AbortController abort
 * - Skips a tick if a real event was pushed within heartbeatMs/2 (activity-aware)
 * - Stopped on end() and bindAbort cleanup
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {{
 *   heartbeatMs?: number,
 *   heartbeat?: boolean,
 *   ndjsonHeartbeat?: boolean,
 * }} [opts]
 */
export function createStreamWriter(req, res, opts = {}) {
  const ndjson = prefersNdjson(req);
  const heartbeatMs = opts.heartbeatMs ?? 15_000;
  const heartbeatEnabled =
    opts.heartbeat !== false &&
    (ndjson ? opts.ndjsonHeartbeat !== false : true);

  let eventId = 0;
  let closed = false;
  let lastPushAt = Date.now();
  let heartbeatTimer = null;
  /** @type {AbortController | null} */
  let boundController = null;

  const isOpen = () => !closed && isSSEOpen(res);

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function writeHeartbeat() {
    if (!isOpen()) return false;
    // Activity-aware: skip if we recently sent a real event
    if (Date.now() - lastPushAt < heartbeatMs / 2) return true;
    if (ndjson) {
      return safeWrite(
        res,
        JSON.stringify({ event: "ping", at: Date.now() }) + "\n"
      );
    }
    // SSE comment ping — does not create a message event
    return safeWrite(res, ": ping\n\n");
  }

  function onHeartbeatFail(reason) {
    stopHeartbeat();
    if (boundController && !boundController.signal.aborted) {
      try {
        boundController.abort(
          reason instanceof Error ? reason : new Error(String(reason || "heartbeat_failed"))
        );
      } catch {
        try {
          boundController.abort();
        } catch {
          /* */
        }
      }
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    if (!heartbeatEnabled || heartbeatMs <= 0) return;
    heartbeatTimer = setInterval(() => {
      if (!isOpen()) {
        onHeartbeatFail(new Error("heartbeat_dead"));
        return;
      }
      if (!writeHeartbeat()) {
        onHeartbeatFail(new Error("heartbeat_write_failed"));
      }
    }, heartbeatMs);
    if (typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();
  }

  if (ndjson) {
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Powered-By": "XClaw-Gateway",
      "X-XClaw-Stream": "ndjson",
      });
    if (typeof res.flushHeaders === "function") res.flushHeaders();
  } else {
    initSSE(res);
  }

  // Heartbeat runs for the life of the stream (not only after bindAbort)
  startHeartbeat();

  const push = (eventName, payload = {}) => {
    if (!isOpen()) return false;
    eventId += 1;
    lastPushAt = Date.now();
    if (ndjson) {
      const row = {
        event: eventName || "message",
        id: String(eventId),
        at: lastPushAt,
        ...(payload && typeof payload === "object" ? payload : { data: payload }),
      };
      try {
        return safeWrite(res, JSON.stringify(row) + "\n");
      } catch {
        return false;
      }
    }
    return sendSSE(
      res,
      eventName,
      { ...payload, at: lastPushAt },
      String(eventId)
    );
  };

  const end = (endOpts = {}) => {
    if (closed) return;
    stopHeartbeat();
    if (ndjson) {
      if (!endOpts.skipDone && isOpen()) {
        eventId += 1;
        safeWrite(
          res,
          JSON.stringify({
            event: "done",
            id: String(eventId),
            ok: true,
            at: Date.now(),
          }) + "\n"
        );
      }
      closed = true;
      try {
        res.end();
      } catch {
        /* */
      }
      return;
    }
    closed = true;
    closeSSE(res, endOpts);
  };

  /**
   * Wire client disconnect → AbortController; heartbeat already running.
   * @param {AbortController} controller
   * @param {{ heartbeatMs?: number, heartbeat?: boolean }} [o]
   * @returns {() => void} cleanup
   */
  const bindAbort = (controller, o = {}) => {
    boundController = controller;
    // Allow per-bind override of interval (restart timer)
    if (o.heartbeatMs != null || o.heartbeat != null) {
      // Only restart if explicitly overridden
      if (o.heartbeat === false) {
        stopHeartbeat();
      } else if (o.heartbeatMs != null && o.heartbeatMs !== heartbeatMs) {
        // local override: replace interval
        stopHeartbeat();
        const ms = o.heartbeatMs;
        if (ms > 0 && o.heartbeat !== false) {
          heartbeatTimer = setInterval(() => {
            if (!isOpen()) {
              onHeartbeatFail(new Error("heartbeat_dead"));
              return;
            }
            if (!writeHeartbeat()) {
              onHeartbeatFail(new Error("heartbeat_write_failed"));
            }
          }, ms);
          if (typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();
        }
      }
    }

    let cleaned = false;
    const abort = (reason) => {
      if (!controller.signal.aborted) {
        try {
          controller.abort(
            reason instanceof Error
              ? reason
              : new Error(typeof reason === "string" ? reason : "client_gone")
          );
        } catch {
          try {
            controller.abort();
          } catch {
            /* */
          }
        }
      }
    };

    const onClose = () => abort(new Error("client_close"));
    const onReqError = () => abort(new Error("req_error"));
    const onResError = () => abort(new Error("res_error"));
    const onAborted = () => abort(new Error("req_aborted"));

    req.on("close", onClose);
    req.on("error", onReqError);
    req.on("aborted", onAborted);
    res.on("close", onClose);
    res.on("error", onResError);

    if (req.aborted || res.writableEnded || res.destroyed) {
      abort(new Error("already_gone"));
    }

    return () => {
      if (cleaned) return;
      cleaned = true;
      stopHeartbeat();
      boundController = null;
      req.off("close", onClose);
      req.off("error", onReqError);
      req.off("aborted", onAborted);
      res.off("close", onClose);
      res.off("error", onResError);
    };
  };

  return {
    mode: ndjson ? "ndjson" : "sse",
    push,
    end,
    isOpen,
    bindAbort,
    /** @internal test/ops */
    _heartbeat: {
      get running() {
        return heartbeatTimer != null;
      },
      stop: stopHeartbeat,
      start: startHeartbeat,
      beat: writeHeartbeat,
      get lastPushAt() {
        return lastPushAt;
      },
      heartbeatMs,
    },
  };
}



// Re-export custom abort handler helpers for stream authors
export {
  onAbort,
  AbortScope,
  withAbortScope,
  linkAbort,
  anySignal,
  abortSignalAny,
  installAbortSignalAny,
  timeoutSignal,
  abortSignalTimeout,
  createTimeoutError,
  installAbortSignalTimeout,
  createNestedSignal,
  createNestedScope,
  toAbortError,
  abortSignal,
  abort,
} from "../utils/abort-handlers.mjs";
