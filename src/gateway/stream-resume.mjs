/**
 * Last-Event-ID resume for gateway streams (agent / swarm / custom).
 *
 * Protocol:
 *   - Every event gets a monotonic string id (also sent as SSE id: / NDJSON "id")
 *   - Client stores last seen id
 *   - On reconnect: send Last-Event-ID header, ?lastEventId=, or body.lastEventId
 *   - Optional body.streamId to attach to an existing run buffer
 *   - Server replays eventsAfterLastId, then continues live if still running
 */

import { eventsAfterLastId } from "../utils/sse-reconnect.mjs";
import crypto from "node:crypto";
import { createBoundedQueue, DropPolicy } from "../shared/bounded-queue.mjs";

const DEFAULT_CAPACITY = 500;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_HEARTBEAT_MS = 15_000;

/**
 * Resolve stream buffer + heartbeat options from cfg / env / defaults.
 * @param {object} [cfg]
 * @returns {{ capacity: number, ttlMs: number, heartbeatMs: number, backoff: string, baseMs: number, maxMs: number, maxResumeCycles: number }}
 */
export function resolveStreamOptsFromConfig(cfg = {}) {
  const s = cfg?.stream || {};
  const capacity = Number(s.capacity);
  const ttlMs = Number(s.ttlMs);
  const heartbeatMs = Number(s.heartbeatMs);
  const baseMs = Number(s.baseMs);
  const maxMs = Number(s.maxMs);
  const maxResumeCycles = Number(s.maxResumeCycles);
  return {
    capacity: Number.isFinite(capacity) && capacity > 0 ? Math.floor(capacity) : DEFAULT_CAPACITY,
    ttlMs: Number.isFinite(ttlMs) && ttlMs >= 0 ? Math.floor(ttlMs) : DEFAULT_TTL_MS,
    heartbeatMs:
      Number.isFinite(heartbeatMs) && heartbeatMs >= 0
        ? Math.floor(heartbeatMs)
        : DEFAULT_HEARTBEAT_MS,
    backoff: s.backoff || "full",
    baseMs: Number.isFinite(baseMs) && baseMs > 0 ? Math.floor(baseMs) : 1000,
    maxMs: Number.isFinite(maxMs) && maxMs > 0 ? Math.floor(maxMs) : 30_000,
    maxResumeCycles:
      Number.isFinite(maxResumeCycles) && maxResumeCycles >= 0
        ? Math.floor(maxResumeCycles)
        : 5,
  };
}

/** @type {Map<string, StreamEventLog>} */
const registry = new Map();

let seqCounter = 0;

/**
 * Extract last event id from HTTP request + optional JSON body.
 * @param {import('http').IncomingMessage} req
 * @param {object} [body]
 * @returns {string|null}
 */
export function parseLastEventId(req, body = null) {
  const h = req?.headers || {};
  const fromHeader =
    h["last-event-id"] ||
    h["Last-Event-ID"] ||
    h["x-last-event-id"] ||
    h["X-Last-Event-ID"];
  if (fromHeader != null && String(fromHeader).trim()) {
    return String(fromHeader).trim();
  }

  try {
    const u = new URL(req.url || "/", "http://localhost");
    const q =
      u.searchParams.get("lastEventId") ||
      u.searchParams.get("last_event_id") ||
      u.searchParams.get("Last-Event-ID");
    if (q != null && String(q).trim()) return String(q).trim();
  } catch {
    /* */
  }

  if (body && typeof body === "object") {
    const b =
      body.lastEventId ||
      body.last_event_id ||
      body.lastEventID;
    if (b != null && String(b).trim()) return String(b).trim();
  }
  return null;
}

/**
 * Extract stream id for resume attachment.
 * @param {import('http').IncomingMessage} req
 * @param {object} [body]
 * @returns {string|null}
 */
export function parseStreamId(req, body = null) {
  try {
    const u = new URL(req.url || "/", "http://localhost");
    const q = u.searchParams.get("streamId") || u.searchParams.get("stream_id");
    if (q) return String(q).trim();
  } catch {
    /* */
  }
  if (body && typeof body === "object") {
    const b = body.streamId || body.stream_id || body.runId || body.run_id;
    if (b != null && String(b).trim()) return String(b).trim();
  }
  return null;
}

export function newStreamId(prefix = "s") {
  seqCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${seqCounter.toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

/**
 * Monotonic event log with optional live subscribers.
 */
export class StreamEventLog {
  /**
   * @param {string} id
   * @param {{ capacity?: number, ttlMs?: number }} [opts]
   */
  constructor(id, opts = {}) {
    this.id = id;
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this._queue = createBoundedQueue({
      maxsize: this.capacity,
      policy: DropPolicy.DROP_OLDEST,
    });
    /** @type {Set<(entry: object) => void>} */
    this.subscribers = new Set();
    this.status = "live";
    this.createdAt = Date.now();
    this.finishedAt = null;
    this._expireTimer = null;
  }

  get events() {
    return this._queue.toArray();
  }

  append(eventName, payload = {}, explicitId = null) {
    const entry = {
      id: explicitId != null ? String(explicitId) : nextEventId(this),
      event: eventName || "message",
      payload: payload && typeof payload === "object" ? { ...payload } : { data: payload },
      at: Date.now(),
    };
    this._queue.push(entry);
    for (const sub of this.subscribers) {
      try {
        sub(entry);
      } catch {
        this.subscribers.delete(sub);
      }
    }
    return entry;
  }

  after(lastEventId) {
    return eventsAfterLastId(this.events, lastEventId);
  }

  bufferMetrics() {
    return this._queue.metrics;
  }

  subscribe(fn) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  markEnded(status = "ended") {
    this.status = status;
    this.finishedAt = Date.now();
    this._scheduleExpire();
  }

  _scheduleExpire() {
    if (this._expireTimer) clearTimeout(this._expireTimer);
    this._expireTimer = setTimeout(() => {
      registry.delete(this.id);
    }, this.ttlMs);
    if (typeof this._expireTimer.unref === "function") this._expireTimer.unref();
  }

  snapshot() {
    const m = this._queue.metrics;
    return {
      streamId: this.id,
      status: this.status,
      eventCount: this.events.length,
      createdAt: this.createdAt,
      finishedAt: this.finishedAt,
      subscribers: this.subscribers.size,
      dropped: m.dropped,
      received: m.received,
    };
  }
}

let eventSeq = 0;
function nextEventId(log) {
  eventSeq += 1;
  return `${log.id}:${eventSeq}`;
}

export function getOrCreateStreamLog(id, opts = {}) {
  let log = registry.get(id);
  if (!log) {
    log = new StreamEventLog(id, opts);
    registry.set(id, log);
  }
  return log;
}

export function getStreamLog(id) {
  return registry.get(id) || null;
}

export function deleteStreamLog(id) {
  const log = registry.get(id);
  if (log?._expireTimer) clearTimeout(log._expireTimer);
  registry.delete(id);
}

export function resolveStreamResume(req, body = {}, opts = {}) {
  const lastEventId = parseLastEventId(req, body);
  const requestedId = parseStreamId(req, body);
  const prefix = opts.prefix || "s";

  if (requestedId) {
    const log = getStreamLog(requestedId);
    if (!log) {
      return {
        mode: "missing",
        streamId: requestedId,
        lastEventId,
        log: null,
        replay: [],
      };
    }
    const replay = log.after(lastEventId);
    if (log.status === "live") {
      return {
        mode: "resume-live",
        streamId: requestedId,
        lastEventId,
        log,
        replay,
      };
    }
    return {
      mode: "replay-only",
      streamId: requestedId,
      lastEventId,
      log,
      replay,
    };
  }

  const streamId = newStreamId(prefix);
  const log = getOrCreateStreamLog(streamId, {
    capacity: opts.capacity ?? DEFAULT_CAPACITY,
    ttlMs: opts.ttlMs ?? DEFAULT_TTL_MS,
  });
  return {
    mode: "new",
    streamId,
    lastEventId: null,
    log,
    replay: [],
  };
}

export function attachWriterToLog(log, opts) {
  const push = opts.push;
  const live = opts.live !== false && log.status === "live";
  const replay = log.after(opts.lastEventId || null);
  let replayed = 0;

  for (const entry of replay) {
    const ok = push(entry.event, {
      ...entry.payload,
      id: entry.id,
      streamId: log.id,
      resumed: true,
      at: entry.at,
    });
    if (ok) replayed += 1;
    else break;
  }

  let unsubscribe = () => {};
  if (live) {
    unsubscribe = log.subscribe((entry) => {
      push(entry.event, {
        ...entry.payload,
        id: entry.id,
        streamId: log.id,
        at: entry.at,
      });
    });
  }

  function record(eventName, payload = {}) {
    return log.append(eventName, { ...payload, streamId: log.id });
  }

  return { record, unsubscribe, replayed };
}

export function createProducer(log, push) {
  return function produce(eventName, payload = {}) {
    const entry = log.append(eventName, { ...payload, streamId: log.id });
    push(eventName, {
      ...entry.payload,
      id: entry.id,
      streamId: log.id,
      at: entry.at,
    });
    return entry;
  };
}

export function listStreamLogs() {
  return [...registry.values()].map((l) => l.snapshot());
}

export function renderStreamRegistryPrometheus() {
  const snaps = listStreamLogs();
  const lines = [];
  let live = 0;
  let ended = 0;
  let aborted = 0;
  let events = 0;
  let subs = 0;
  for (const s of snaps) {
    if (s.status === "live") live += 1;
    else if (s.status === "aborted") aborted += 1;
    else ended += 1;
    events += s.eventCount || 0;
    subs += s.subscribers || 0;
  }
  lines.push("# HELP xclaw_stream_logs Active stream event logs in registry");
  lines.push("# TYPE xclaw_stream_logs gauge");
  lines.push(`xclaw_stream_logs{status="live"} ${live}`);
  lines.push(`xclaw_stream_logs{status="ended"} ${ended}`);
  lines.push(`xclaw_stream_logs{status="aborted"} ${aborted}`);
  lines.push("# HELP xclaw_stream_log_events_buffered Total events buffered across logs");
  lines.push("# TYPE xclaw_stream_log_events_buffered gauge");
  lines.push(`xclaw_stream_log_events_buffered ${events}`);
  lines.push("# HELP xclaw_stream_log_subscribers Live writer subscribers");
  lines.push("# TYPE xclaw_stream_log_subscribers gauge");
  lines.push(`xclaw_stream_log_subscribers ${subs}`);
  return lines.join("\n") + "\n";
}

export default {
  parseLastEventId,
  parseStreamId,
  newStreamId,
  StreamEventLog,
  getOrCreateStreamLog,
  getStreamLog,
  deleteStreamLog,
  resolveStreamResume,
  attachWriterToLog,
  createProducer,
  listStreamLogs,
  renderStreamRegistryPrometheus,
  resolveStreamOptsFromConfig,
  streamRegistryStats,
};

export function streamRegistryStats() {
  let events = 0;
  let dropped = 0;
  let received = 0;
  let subscribers = 0;
  for (const log of registry.values()) {
    const m = typeof log.bufferMetrics === "function" ? log.bufferMetrics() : {};
    events += log.events?.length || m.depth || 0;
    dropped += m.dropped || 0;
    received += m.received || 0;
    subscribers += log.subscribers?.size || 0;
  }
  return {
    streams: registry.size,
    events,
    dropped,
    received,
    subscribers,
  };
}
