/**
 * Client-side Last-Event-ID + streamId resume for XClaw streams
 * (agent / swarm / webchat).
 *
 * Wraps createStreamReconnector:
 *   - Learns streamId from lifecycle / events
 *   - Tracks lastEventId; dedupes by id
 *   - On transient drop, next attempt sends resume:true + streamId + lastEventId
 *   - Optional outer retry after reconnector exhausts attempts
 */

import {
  createStreamReconnector,
  reconnectDelayMs,
  sleepMs,
} from "../utils/sse-reconnect.mjs";
import {
  recordStreamError,
  recordResumeEvent,
} from "../utils/stream-telemetry.mjs";

/**
 * @typedef {"agent"|"swarm"|"webchat"|string} StreamKind
 */

/**
 * Default paths on the gateway.
 * @type {Record<string, string>}
 */
export const STREAM_PATHS = Object.freeze({
  agent: "/agent/run/stream",
  swarm: "/swarm/run/stream",
  webchat: "/channel/webchat/message/stream",
});


/** @typedef {"STREAM_NOT_FOUND"|"STREAM_EXPIRED"|"AUTH"|"FORBIDDEN"|"BAD_REQUEST"|"HEARTBEAT_TIMEOUT"|"NETWORK"|"MAX_RESUME_CYCLES"|"SERVER"|"ABORTED"|"UNKNOWN"} ResumeErrorCode */

export class ResumeError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: ResumeErrorCode, status?: number, streamId?: string|null, lastEventId?: string|null, retryable?: boolean, cause?: any, details?: object }} [meta]
   */
  constructor(message, meta = {}) {
    super(message);
    this.name = "ResumeError";
    this.code = meta.code || "UNKNOWN";
    this.status = meta.status;
    this.streamId = meta.streamId ?? null;
    this.lastEventId = meta.lastEventId ?? null;
    this.retryable = meta.retryable !== false && isRetryableCode(this.code);
    this.details = meta.details || null;
    if (meta.cause !== undefined) this.cause = meta.cause;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      status: this.status,
      streamId: this.streamId,
      lastEventId: this.lastEventId,
      retryable: this.retryable,
      details: this.details,
    };
  }
}

export function isRetryableCode(code) {
  switch (String(code || "")) {
    case "STREAM_NOT_FOUND":
    case "STREAM_EXPIRED":
    case "AUTH":
    case "FORBIDDEN":
    case "BAD_REQUEST":
    case "MAX_RESUME_CYCLES":
    case "ABORTED":
      return false;
    case "HEARTBEAT_TIMEOUT":
    case "NETWORK":
    case "SERVER":
    case "UNKNOWN":
    default:
      return true;
  }
}

/**
 * Classify transport / HTTP / server event errors into ResumeError.
 * @param {any} err
 * @param {{ streamId?: string|null, lastEventId?: string|null }} [ctx]
 * @returns {ResumeError}
 */
export function classifyResumeError(err, ctx = {}) {
  if (err instanceof ResumeError) {
    if (ctx.streamId && !err.streamId) err.streamId = ctx.streamId;
    if (ctx.lastEventId && !err.lastEventId) err.lastEventId = ctx.lastEventId;
    return err;
  }

  const streamId = ctx.streamId ?? null;
  const lastEventId = ctx.lastEventId ?? null;
  const msg = String(err?.message || err || "unknown error");
  const status = err?.status != null ? Number(err.status) : undefined;
  const codeRaw = err?.code;

  if (codeRaw === "HEARTBEAT_TIMEOUT" || /heartbeat_timeout/i.test(msg)) {
    return new ResumeError(msg || "Heartbeat timeout", {
      code: "HEARTBEAT_TIMEOUT",
      streamId,
      lastEventId,
      retryable: true,
      cause: err,
    });
  }

  if (codeRaw === "ABORTED" || codeRaw === "ABORT_ERR" || err?.name === "AbortError") {
    return new ResumeError(msg || "Aborted", {
      code: "ABORTED",
      streamId,
      lastEventId,
      retryable: false,
      cause: err,
    });
  }

  if (
    codeRaw === "stream_not_found" ||
    codeRaw === "STREAM_NOT_FOUND" ||
    /stream_not_found|unknown streamid/i.test(msg)
  ) {
    return new ResumeError(msg || "Stream not found", {
      code: "STREAM_NOT_FOUND",
      streamId,
      lastEventId,
      retryable: false,
      cause: err,
    });
  }

  if (status === 401 || codeRaw === 401) {
    return new ResumeError(msg || "Unauthorized", {
      code: "AUTH",
      status: 401,
      streamId,
      lastEventId,
      retryable: false,
      cause: err,
    });
  }
  if (status === 403 || codeRaw === 403) {
    return new ResumeError(msg || "Forbidden", {
      code: "FORBIDDEN",
      status: 403,
      streamId,
      lastEventId,
      retryable: false,
      cause: err,
    });
  }
  if (status === 400 || status === 404) {
    const code = status === 404 ? "STREAM_NOT_FOUND" : "BAD_REQUEST";
    return new ResumeError(msg || `HTTP ${status}`, {
      code,
      status,
      streamId,
      lastEventId,
      retryable: false,
      cause: err,
    });
  }
  if (status === 429 || (status >= 500 && status <= 599) || codeRaw === "TRANSIENT") {
    return new ResumeError(msg || `HTTP ${status || "transient"}`, {
      code: "SERVER",
      status,
      streamId,
      lastEventId,
      retryable: true,
      cause: err,
      details: err?.retryAfter != null ? { retryAfter: err.retryAfter } : null,
    });
  }

  if (/network|fetch|ECONN|ETIMEDOUT|ENOTFOUND|socket|ECONNRESET/i.test(msg)) {
    return new ResumeError(msg, {
      code: "NETWORK",
      streamId,
      lastEventId,
      retryable: true,
      cause: err,
    });
  }

  return new ResumeError(msg, {
    code: "UNKNOWN",
    status,
    streamId,
    lastEventId,
    retryable: true,
    cause: err,
  });
}

/**
 * Turn a server stream error event into ResumeError when fatal.
 * @param {object} row
 * @param {{ streamId?: string|null, lastEventId?: string|null }} [ctx]
 * @returns {ResumeError|null}
 */
export function resumeErrorFromEvent(row, ctx = {}) {
  if (!row || typeof row !== "object") return null;
  const event = row.event || row.type;
  if (event !== "error" && row.ok !== false) return null;

  const code = row.code || row.errorCode;
  const msg = String(row.error || row.message || code || "stream error");

  if (code === "stream_not_found" || /unknown streamid/i.test(msg)) {
    return new ResumeError(msg, {
      code: "STREAM_NOT_FOUND",
      streamId: row.streamId || ctx.streamId,
      lastEventId: ctx.lastEventId,
      retryable: false,
      details: row,
    });
  }
  if (code === "message_required" || code === "goal_required") {
    return new ResumeError(msg, {
      code: "BAD_REQUEST",
      streamId: row.streamId || ctx.streamId,
      lastEventId: ctx.lastEventId,
      retryable: false,
      details: row,
    });
  }
  // Generic server error event — retryable unless aborted
  if (row.aborted) {
    return new ResumeError(msg || "aborted", {
      code: "ABORTED",
      streamId: row.streamId || ctx.streamId,
      lastEventId: ctx.lastEventId,
      retryable: false,
      details: row,
    });
  }
  return null;
}


/**
 * @param {object} opts
 * @param {string} [opts.baseUrl="http://127.0.0.1:18790"]
 * @param {StreamKind} [opts.kind="agent"]
 * @param {string} [opts.url] full URL overrides baseUrl+kind
 * @param {object} [opts.body] initial POST body (message / goal / …)
 * @param {Record<string,string>} [opts.headers]
 * @param {"ndjson"|"sse"|"auto"} [opts.format="ndjson"]
 * @param {(row: object) => void} [opts.onEvent]
 * @param {(status: string, info?: object) => void} [opts.onStatus]
 * @param {(err: Error) => void} [opts.onError]
 * @param {(err: ResumeError) => void} [opts.onResumeError] structured resume failures
 * @param {(info: { streamId: string|null, lastEventId: string|null, attempt: number }) => void} [opts.onResumeState]
 * @param {boolean} [opts.failOnStreamNotFound=true]
 * @param {number} [opts.heartbeatMs=15000]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.baseMs=1000]
 * @param {number} [opts.maxMs=30000]
 * @param {string} [opts.strategy="full"]
 * @param {number} [opts.maxAttempts=0] inner reconnector attempts (0=infinite)
 * @param {number} [opts.maxResumeCycles=0] outer cycles after full failure (0=infinite)
 * @param {string} [opts.streamId] seed for resume-only attach
 * @param {string} [opts.lastEventId] seed
 * @param {AbortSignal} [opts.signal]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {(id: string) => boolean} [opts.shouldDeliver] extra dedupe filter
 */
export function createResumingStreamClient(opts = {}) {
  const kind = opts.kind || "agent";
  const baseUrl = String(opts.baseUrl || "http://127.0.0.1:18790").replace(/\/$/, "");
  const path = STREAM_PATHS[kind] || STREAM_PATHS.agent;
  const url = opts.url || `${baseUrl}${path}`;

  /** Shared body bag — mutated so reconnector buildBody picks up resume fields */
  const bodyBag = {
    ...(opts.body && typeof opts.body === "object" ? opts.body : {}),
  };

  let streamId = opts.streamId ? String(opts.streamId) : null;
  let lastEventId = opts.lastEventId ? String(opts.lastEventId) : null;
  /** @type {Set<string>} */
  const seenIds = new Set();
  if (lastEventId) seenIds.add(lastEventId);

  let closed = false;
  let active = null;
  let resumeCycles = 0;
  let status = "idle";

  if (streamId) {
    bodyBag.streamId = streamId;
    bodyBag.resume = true;
    if (lastEventId) bodyBag.lastEventId = lastEventId;
  }

  function emitState() {
    try {
      opts.onResumeState?.({
        streamId,
        lastEventId,
        attempt: active?.getAttempt?.() ?? 0,
        resumeCycles,
        status,
      });
    } catch {
      /* */
    }
  }

  function rememberFromRow(row) {
    if (!row || typeof row !== "object") return;
    if (row.streamId != null && String(row.streamId)) {
      streamId = String(row.streamId);
      bodyBag.streamId = streamId;
    }
    const id = row.id != null ? String(row.id) : null;
    if (id) {
      lastEventId = id;
      bodyBag.lastEventId = id;
      // After first successful event, future reconnects should resume
      if (streamId) bodyBag.resume = true;
    }
  }

  /** @type {ResumeError|null} */
  let fatalFromEvent = null;

  function emitResumeError(err) {
    try {
      recordStreamError({
        kind,
        code: err?.code || "UNKNOWN",
        message: err?.message || String(err),
        streamId: err?.streamId ?? streamId,
        lastEventId: err?.lastEventId ?? lastEventId,
        retryable: err?.retryable !== false,
        phase: "client",
        extra: err?.details ? { details: err.details } : undefined,
        log: opts.telemetryLog !== false,
      });
    } catch {
      /* */
    }
    try {
      opts.onResumeError?.(err);
    } catch {
      /* */
    }
    try {
      opts.onError?.(err);
    } catch {
      /* */
    }
  }

  function handleEvent(row) {
    rememberFromRow(row);

    const id = row?.id != null ? String(row.id) : null;
    if (id) {
      if (seenIds.has(id)) {
        // Duplicate from replay — skip user callback
        return;
      }
      seenIds.add(id);
      // Bound memory
      if (seenIds.size > 5000) {
        const drop = [...seenIds].slice(0, seenIds.size - 4000);
        for (const d of drop) seenIds.delete(d);
      }
    }

    if (opts.shouldDeliver && id && !opts.shouldDeliver(id)) return;

    // Ignore pure keepalive
    if (row?.event === "ping") return;

    // Server-side resume failures delivered as stream events
    const fatal = resumeErrorFromEvent(row, { streamId, lastEventId });
    if (fatal) {
      fatalFromEvent = fatal;
      emitResumeError(fatal);
      // Deliver to UI; do not abort mid-parse — runSession will throw
      // fatalFromEvent after the server closes the body.
      opts.onEvent?.(row);
      return;
    }

    opts.onEvent?.(row);
  }

  function prepareResumeBody() {
    if (streamId) {
      bodyBag.streamId = streamId;
      bodyBag.resume = true;
    }
    if (lastEventId) {
      bodyBag.lastEventId = lastEventId;
    }
  }

  /**
   * One reconnector session (may internally retry with Last-Event-ID headers).
   */
  async function runSession() {
    prepareResumeBody();
    emitState();

    const reconnector = createStreamReconnector({
      url,
      method: "POST",
      body: bodyBag,
      headers: opts.headers,
      format: opts.format || "ndjson",
      lastEventId: lastEventId || undefined,
      heartbeatMs: opts.heartbeatMs,
      timeoutMs: opts.timeoutMs,
      baseMs: opts.baseMs,
      maxMs: opts.maxMs,
      strategy: opts.strategy || "full",
      maxAttempts: opts.maxAttempts ?? 0,
      signal: opts.signal,
      fetchImpl: opts.fetchImpl,
      onEvent: handleEvent,
      onStatus: (s, info) => {
        status = s;
        // When reconnector is about to reconnect, ensure body has resume fields
        if (s === "backoff" || s === "reconnecting") {
          prepareResumeBody();
        }
        opts.onStatus?.(s, {
          ...info,
          streamId,
          lastEventId,
          resumeCycles,
        });
        emitState();
      },
      onError: (err) => {
        opts.onError?.(err);
      },
    });

    active = reconnector;
    try {
      await reconnector.start();
      status = reconnector.getStatus();
      // Pull final ids
      const lid = reconnector.getLastEventId();
      if (lid) {
        lastEventId = lid;
        bodyBag.lastEventId = lid;
      }
    } finally {
      active = null;
      emitState();
    }
  }

  async function start() {
    if (closed) return;
    status = "starting";
    fatalFromEvent = null;
    emitState();

    while (!closed) {
      if (opts.signal?.aborted) {
        status = "closed";
        emitState();
        return;
      }

      try {
        fatalFromEvent = null;
        await runSession();

        // Session ended: if server sent a fatal error event, surface it
        if (fatalFromEvent) {
          status = "failed";
          emitState();
          throw fatalFromEvent;
        }

        // Clean end from server
        status = "ended";
        recordResumeEvent("resume_ended", {
          kind,
          streamId,
          lastEventId,
          log: opts.telemetryLog !== false,
        });
        emitState();
        return;
      } catch (err) {
        if (closed || opts.signal?.aborted) {
          status = "closed";
          emitState();
          return;
        }

        const classified = fatalFromEvent
          ? fatalFromEvent
          : classifyResumeError(err, { streamId, lastEventId });

        emitResumeError(classified);

        if (!classified.retryable) {
          status = "failed";
          recordResumeEvent("resume_failed", {
            kind,
            streamId,
            lastEventId,
            code: classified.code,
            message: classified.message,
            log: opts.telemetryLog !== false,
          });
          opts.onStatus?.("resume_failed", {
            code: classified.code,
            message: classified.message,
            streamId,
            lastEventId,
            retryable: false,
          });
          emitState();
          throw classified;
        }

        const maxCycles = opts.maxResumeCycles ?? 0;
        if (maxCycles > 0 && resumeCycles >= maxCycles) {
          const maxErr = new ResumeError(
            `Max resume cycles exceeded (${maxCycles}): ${classified.message}`,
            {
              code: "MAX_RESUME_CYCLES",
              streamId,
              lastEventId,
              retryable: false,
              cause: classified,
              details: { maxResumeCycles: maxCycles, resumeCycles },
            }
          );
          emitResumeError(maxErr);
          status = "failed";
          recordResumeEvent("resume_failed", {
            kind,
            streamId,
            lastEventId,
            code: maxErr.code,
            message: maxErr.message,
            resumeCycles,
            log: opts.telemetryLog !== false,
          });
          opts.onStatus?.("resume_failed", {
            code: maxErr.code,
            message: maxErr.message,
            streamId,
            lastEventId,
            retryable: false,
          });
          emitState();
          throw maxErr;
        }

        resumeCycles += 1;
        prepareResumeBody();
        const delay = reconnectDelayMs(resumeCycles - 1, {
          baseMs: opts.baseMs ?? 1000,
          maxMs: opts.maxMs ?? 30_000,
          strategy: opts.strategy || "full",
        });
        status = "resume_backoff";
        recordResumeEvent("resume_backoff", {
          kind,
          streamId,
          lastEventId,
          code: classified.code,
          message: classified.message,
          delayMs: delay,
          resumeCycles,
          log: opts.telemetryLog !== false,
        });
        opts.onStatus?.("resume_backoff", {
          resumeCycles,
          delayMs: delay,
          streamId,
          lastEventId,
          code: classified.code,
          error: classified.message,
          retryable: true,
        });
        emitState();
        try {
          await sleepMs(delay, opts.signal);
        } catch {
          status = "closed";
          emitState();
          return;
        }
      }
    }
  }

  function close() {
    closed = true;
    try {
      active?.close?.();
    } catch {
      /* */
    }
    status = "closed";
    emitState();
  }

  return {
    start,
    close,
    getStreamId: () => streamId,
    getLastEventId: () => lastEventId,
    getSeenCount: () => seenIds.size,
    getStatus: () => status,
    getResumeCycles: () => resumeCycles,
    /** Snapshot for persistence / debugging */
    getState: () => ({
      streamId,
      lastEventId,
      seenCount: seenIds.size,
      resumeCycles,
      status,
      body: { ...bodyBag },
    }),
  };
}

/**
 * Convenience: agent run with resume.
 */
export function streamAgent(opts) {
  return createResumingStreamClient({ ...opts, kind: "agent" });
}

/**
 * Convenience: swarm run with resume.
 */
export function streamSwarm(opts) {
  return createResumingStreamClient({ ...opts, kind: "swarm" });
}

/**
 * Convenience: webchat message with resume.
 */
export function streamWebChat(opts) {
  return createResumingStreamClient({ ...opts, kind: "webchat" });
}

export default {
  STREAM_PATHS,
  ResumeError,
  isRetryableCode,
  classifyResumeError,
  resumeErrorFromEvent,
  createResumingStreamClient,
  streamAgent,
  streamSwarm,
  streamWebChat,
};
