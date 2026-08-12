/**
 * Telemetry for stream / resume errors (client + gateway).
 *
 * Cardinality policy
 * ──────────────────
 * Prometheus counters ONLY accept low-cardinality labels:
 *   kind, code, phase, event
 *
 * High-cardinality fields (streamId, lastEventId, message, userId, …)
 * go to structured logs / recent ring — never to metric series keys.
 *
 * Unknown kind/code/phase/event values are mapped to "other" so a
 * buggy client cannot explode series count.
 */

/** @type {Map<string, number>} */
const counters = new Map();

/** @type {Array<object>} */
const recent = [];
const RECENT_MAX = 100;

/** @type {Set<(entry: object) => void>} */
const listeners = new Set();

/** Labels allowed on Prometheus counter series */
export const PROM_LABEL_ALLOWLIST = Object.freeze([
  "kind",
  "code",
  "phase",
  "event",
]);

/** Explicitly banned from metric labels (high cardinality / PII risk) */
export const PROM_LABEL_DENYLIST = Object.freeze([
  "streamId",
  "stream_id",
  "lastEventId",
  "last_event_id",
  "message",
  "error",
  "userId",
  "user_id",
  "sessionId",
  "session_id",
  "runId",
  "run_id",
  "path",
  "url",
  "host",
  "ip",
  "requestId",
  "request_id",
  "traceId",
  "trace_id",
]);

const KIND_ALLOW = new Set(["agent", "swarm", "webchat", "gateway", "unknown", "other"]);
const PHASE_ALLOW = new Set(["client", "server", "other"]);
const EVENT_ALLOW = new Set([
  "resume_backoff",
  "resume_failed",
  "resume_ended",
  "resume_start",
  "other",
]);
/** Bounded set of known codes; everything else → other */
const CODE_ALLOW = new Set([
  "STREAM_NOT_FOUND",
  "STREAM_EXPIRED",
  "AUTH",
  "FORBIDDEN",
  "BAD_REQUEST",
  "HEARTBEAT_TIMEOUT",
  "NETWORK",
  "MAX_RESUME_CYCLES",
  "SERVER",
  "ABORTED",
  "UNKNOWN",
  "other",
]);

/**
 * Strip high-cardinality / unknown labels for metric keys.
 * @param {Record<string, any>} labels
 * @param {{ allow?: string[] }} [opts]
 * @returns {Record<string, string>}
 */
export function sanitizePromLabels(labels = {}, opts = {}) {
  const allow = new Set(opts.allow || PROM_LABEL_ALLOWLIST);
  /** @type {Record<string, string>} */
  const out = {};
  for (const [rawK, rawV] of Object.entries(labels || {})) {
    const k = String(rawK);
    if (!allow.has(k)) continue;
    if (PROM_LABEL_DENYLIST.includes(k)) continue;
    if (rawV == null || rawV === "") continue;
    let v = String(rawV).slice(0, 64); // hard length cap
    if (k === "kind") v = KIND_ALLOW.has(v) ? v : "other";
    else if (k === "phase") v = PHASE_ALLOW.has(v) ? v : "other";
    else if (k === "event") v = EVENT_ALLOW.has(v) ? v : "other";
    else if (k === "code") {
      const up = v.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 48);
      v = CODE_ALLOW.has(up) ? up : "other";
    }
    out[k] = v;
  }
  return out;
}

/**
 * Detect whether a label set would be unsafe for Prometheus.
 * @param {Record<string, any>} labels
 */
export function isHighCardinalityLabelSet(labels = {}) {
  for (const k of Object.keys(labels || {})) {
    if (PROM_LABEL_DENYLIST.includes(k)) return true;
    if (!PROM_LABEL_ALLOWLIST.includes(k)) return true;
  }
  return false;
}

function key(name, labels = {}) {
  const safe = sanitizePromLabels(labels);
  const parts = Object.keys(safe)
    .sort()
    .map((k) => `${k}=${String(safe[k]).replace(/[,\n"]/g, "_")}`);
  return parts.length ? `${name}|${parts.join(",")}` : name;
}

/**
 * @param {string} name
 * @param {Record<string, string|number>} [labels]
 * @param {number} [delta=1]
 */
export function incr(name, labels = {}, delta = 1) {
  const k = key(name, labels);
  counters.set(k, (counters.get(k) || 0) + delta);
  return counters.get(k);
}

/**
 * @param {string} name
 * @param {Record<string, string|number>} [labels]
 */
export function getCounter(name, labels = {}) {
  return counters.get(key(name, labels)) || 0;
}

export function snapshotCounters() {
  const out = {};
  for (const [k, v] of counters) out[k] = v;
  return out;
}

/** Number of distinct in-process series (cardinality monitor) */
export function seriesCount() {
  return counters.size;
}

export function resetTelemetry() {
  counters.clear();
  recent.length = 0;
}

/**
 * Structured log + counter for a resume/stream error.
 *
 * streamId / lastEventId / message → logs only
 * kind / code / phase → metrics
 *
 * @param {object} opts
 * @param {string} [opts.kind]
 * @param {string} [opts.code]
 * @param {string} [opts.message]
 * @param {string|null} [opts.streamId]
 * @param {string|null} [opts.lastEventId]
 * @param {boolean} [opts.retryable]
 * @param {string} [opts.phase]
 * @param {object} [opts.extra]
 * @param {boolean} [opts.log=true]
 * @param {(line: string) => void} [opts.logger]
 */
export function recordStreamError(opts = {}) {
  const kind = String(opts.kind || "unknown");
  const code = String(opts.code || "UNKNOWN");
  const phase = String(opts.phase || "client");
  const retryable = Boolean(opts.retryable);

  // Metrics: low-cardinality only (sanitizePromLabels applied inside incr)
  incr("xclaw_stream_errors_total", { kind, code, phase });
  incr("xclaw_stream_errors_by_code", { code });
  if (retryable) {
    incr("xclaw_stream_errors_retryable_total", { kind });
  } else {
    incr("xclaw_stream_errors_fatal_total", { kind });
  }

  // Logs: full context including high-cardinality ids
  const entry = {
    type: "stream_error",
    at: new Date().toISOString(),
    kind,
    code,
    phase,
    retryable,
    message: opts.message || code,
    streamId: opts.streamId ?? null,
    lastEventId: opts.lastEventId ?? null,
    ...(opts.extra && typeof opts.extra === "object" ? { extra: opts.extra } : {}),
  };

  recent.push(entry);
  while (recent.length > RECENT_MAX) recent.shift();

  for (const fn of listeners) {
    try {
      fn(entry);
    } catch {
      /* */
    }
  }

  if (opts.log !== false) {
    const logger = opts.logger || defaultLogger;
    try {
      logger(JSON.stringify(entry));
    } catch {
      /* */
    }
  }

  return entry;
}

/**
 * Resume lifecycle telemetry (backoff, success, failed).
 * @param {string} event resume_backoff|resume_failed|resume_ended|…
 * @param {object} [info]
 */
export function recordResumeEvent(event, info = {}) {
  const kind = String(info.kind || "unknown");
  incr("xclaw_stream_resume_events_total", {
    kind,
    event: String(event),
  });

  const entry = {
    type: "stream_resume",
    event: String(event),
    at: new Date().toISOString(),
    kind,
    streamId: info.streamId ?? null,
    lastEventId: info.lastEventId ?? null,
    code: info.code ?? null,
    delayMs: info.delayMs ?? null,
    resumeCycles: info.resumeCycles ?? null,
    message: info.message ?? null,
  };

  recent.push(entry);
  while (recent.length > RECENT_MAX) recent.shift();

  if (info.log !== false) {
    try {
      (info.logger || defaultLogger)(JSON.stringify(entry));
    } catch {
      /* */
    }
  }

  return entry;
}

function defaultLogger(line) {
  console.error(`[xclaw:telemetry] ${line}`);
}

export function listRecentTelemetry({ limit = 50 } = {}) {
  const n = Math.min(RECENT_MAX, Math.max(1, Number(limit) || 50));
  return recent.slice(-n);
}

export function subscribeTelemetry(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Prometheus exposition fragment for stream telemetry.
 * @returns {string}
 */
export function renderStreamTelemetryPrometheus() {
  const lines = [];

  function emitLabeled(metric, prefix) {
    for (const [k, v] of counters) {
      if (!k.startsWith(prefix + "|") && k !== prefix) continue;
      if (k === prefix) {
        lines.push(`${metric} ${v}`);
        continue;
      }
      const labelStr = k.slice(prefix.length + 1);
      const labels = labelStr
        .split(",")
        .filter(Boolean)
        .map((pair) => {
          const i = pair.indexOf("=");
          if (i < 0) return null;
          const lk = pair.slice(0, i);
          // Defense in depth: never emit denied labels even if present in map
          if (PROM_LABEL_DENYLIST.includes(lk)) return null;
          if (!PROM_LABEL_ALLOWLIST.includes(lk)) return null;
          const lv = pair
            .slice(i + 1)
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"');
          return `${lk}="${lv}"`;
        })
        .filter(Boolean)
        .join(",");
      lines.push(labels ? `${metric}{${labels}} ${v}` : `${metric} ${v}`);
    }
  }

  lines.push("# HELP xclaw_stream_errors_total Stream/resume errors by kind, code, phase");
  lines.push("# TYPE xclaw_stream_errors_total counter");
  emitLabeled("xclaw_stream_errors_total", "xclaw_stream_errors_total");

  lines.push("# HELP xclaw_stream_errors_fatal_total Fatal (non-retryable) stream errors");
  lines.push("# TYPE xclaw_stream_errors_fatal_total counter");
  emitLabeled("xclaw_stream_errors_fatal_total", "xclaw_stream_errors_fatal_total");

  lines.push("# HELP xclaw_stream_errors_retryable_total Retryable stream errors");
  lines.push("# TYPE xclaw_stream_errors_retryable_total counter");
  emitLabeled(
    "xclaw_stream_errors_retryable_total",
    "xclaw_stream_errors_retryable_total"
  );

  lines.push("# HELP xclaw_stream_resume_events_total Resume lifecycle events");
  lines.push("# TYPE xclaw_stream_resume_events_total counter");
  emitLabeled("xclaw_stream_resume_events_total", "xclaw_stream_resume_events_total");

  // Cardinality self-monitor (single series)
  lines.push("# HELP xclaw_stream_metric_series In-process stream metric series count");
  lines.push("# TYPE xclaw_stream_metric_series gauge");
  lines.push(`xclaw_stream_metric_series ${counters.size}`);

  return lines.join("\n") + "\n";
}

export default {
  PROM_LABEL_ALLOWLIST,
  PROM_LABEL_DENYLIST,
  sanitizePromLabels,
  isHighCardinalityLabelSet,
  incr,
  getCounter,
  snapshotCounters,
  seriesCount,
  resetTelemetry,
  recordStreamError,
  recordResumeEvent,
  listRecentTelemetry,
  subscribeTelemetry,
  renderStreamTelemetryPrometheus,
};
