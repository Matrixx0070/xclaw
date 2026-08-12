/**
 * SSE reconnect helpers (server + client-oriented pure logic).
 *
 * Server: filter ring-buffer by Last-Event-ID
 * Client: exponential backoff schedule (browser uses EventSource with these params)
 */

import { fullJitterBackoffMs, exponentialBackoffMs } from "./backoff.mjs";



/**
 * @param {Array<{ id: string }>} events  chronological (oldest → newest)
 * @param {string | null | undefined} lastEventId
 * @returns {typeof events}
 */
export function eventsAfterLastId(events, lastEventId) {
  if (!lastEventId || !Array.isArray(events) || events.length === 0) {
    return events || [];
  }
  const idx = events.findIndex((e) => String(e.id) === String(lastEventId));
  if (idx < 0) {
    // Unknown id — send full snapshot (client was offline longer than buffer)
    return events;
  }
  return events.slice(idx + 1);
}

/**
 * Exponential backoff with full jitter (delegates to shared backoff module).
 * attempt 0 → U(0, base), then U(0, min(max, base * 2^attempt))
 *
 * @param {number} attempt  zero-based
 * @param {{ baseMs?: number, maxMs?: number, maxDelayMs?: number, random?: () => number, strategy?: string }} [opts]
 * @returns {number} delay ms
 */
export function reconnectDelayMs(attempt, opts = {}) {
  const base = Number(opts.baseMs) > 0 ? Number(opts.baseMs) : 1000;
  const max =
    Number(opts.maxMs) > 0
      ? Number(opts.maxMs)
      : Number(opts.maxDelayMs) > 0
        ? Number(opts.maxDelayMs)
        : 30_000;
  if (opts.strategy === "none" || opts.strategy === "exponential") {
    return exponentialBackoffMs(attempt, { baseMs: base, maxDelayMs: max });
  }
  return fullJitterBackoffMs(attempt, {
    baseMs: base,
    maxDelayMs: max,
    random: opts.random,
  });
}

/**
 * Format one SSE event with id (for resume).
 * @param {string} eventName
 * @param {object|string} data
 * @param {string|number} [id]
 */
export function formatSSEEvent(eventName, data, id) {
  let out = "";
  if (id != null && id !== "") out += `id: ${id}\n`;
  if (eventName) out += `event: ${eventName}\n`;
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  for (const line of String(payload).split("\n")) {
    out += `data: ${line}\n`;
  }
  out += "\n";
  return out;
}

/**
 * Browser-side EventSource reconnect controller (logic only; pass EventSource ctor).
 *
 * @param {object} opts
 * @param {string} opts.url
 * @param {(type: string, data: string, lastEventId: string) => void} opts.onEvent
 * @param {(status: string) => void} [opts.onStatus]
 * @param {typeof EventSource} [opts.EventSourceImpl]
 * @param {number} [opts.baseMs]
 * @param {number} [opts.maxMs]
 * @param {number} [opts.maxAttempts]  0 = infinite
 * @returns {{ close: () => void, getLastEventId: () => string, getAttempt: () => number }}
 */
export function createEventSourceReconnect(opts) {
  const ES = opts.EventSourceImpl || globalThis.EventSource;
  if (!ES) {
    throw new Error("EventSource not available");
  }
  let es = null;
  let closed = false;
  let attempt = 0;
  let timer = null;
  let lastEventId = opts.lastEventId || "";
  const maxAttempts = opts.maxAttempts == null ? 0 : Number(opts.maxAttempts);

  const status = (s) => {
    try {
      opts.onStatus?.(s);
    } catch {
      /* */
    }
  };

  function urlWithLastId() {
    if (!lastEventId) return opts.url;
    try {
      const u = new URL(opts.url, "http://localhost");
      u.searchParams.set("lastEventId", lastEventId);
      // relative path only
      return u.pathname + u.search + u.hash;
    } catch {
      const sep = opts.url.includes("?") ? "&" : "?";
      return `${opts.url}${sep}lastEventId=${encodeURIComponent(lastEventId)}`;
    }
  }

  function connect() {
    if (closed) return;
    status(attempt === 0 ? "connecting" : `reconnecting:${attempt}`);
    try {
      es = new ES(urlWithLastId());
    } catch (e) {
      schedule(e);
      return;
    }

    es.onopen = () => {
      attempt = 0;
      status("live");
    };

    es.onmessage = (msg) => {
      if (msg.lastEventId) lastEventId = msg.lastEventId;
      opts.onEvent?.("message", msg.data, lastEventId);
    };

    // capture named events via generic — EventSource doesn't list them;
    // callers should use addEventListener; we proxy through onopen attach
    const proxy = (type) => {
      es.addEventListener(type, (msg) => {
        if (msg.lastEventId) lastEventId = msg.lastEventId;
        opts.onEvent?.(type, msg.data, lastEventId);
      });
    };
    for (const t of opts.eventTypes || ["ready", "eviction", "error", "ping"]) {
      proxy(t);
    }

    es.onerror = () => {
      try {
        es.close();
      } catch {
        /* */
      }
      es = null;
      schedule();
    };
  }

  function schedule(err) {
    if (closed) return;
    if (maxAttempts > 0 && attempt >= maxAttempts) {
      status("failed");
      return;
    }
    const delay = reconnectDelayMs(attempt, {
      baseMs: opts.baseMs,
      maxMs: opts.maxMs,
    });
    attempt += 1;
    status(`reconnecting:${attempt}:${delay}ms`);
    timer = setTimeout(connect, delay);
  }

  function close() {
    closed = true;
    if (timer) clearTimeout(timer);
    try {
      es?.close();
    } catch {
      /* */
    }
    es = null;
    status("closed");
  }

  connect();

  return {
    close,
    getLastEventId: () => lastEventId,
    getAttempt: () => attempt,
  };
}


/**
 * Sleep that rejects/resolves early on AbortSignal.
 * @param {number} ms
 * @param {AbortSignal} [signal]
 */
export function sleepMs(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

/**
 * Parse one SSE block into { event, data, id }.
 * @param {string} block
 */
export function parseSSEBlock(block) {
  let event = "message";
  let id = null;
  const dataLines = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue; // comment / ping
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("id:")) id = line.slice(3).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  const data = dataLines.join("\n");
  return { event, data, id };
}

/**
 * Stream reconnector for POST (or GET) fetch streams — NDJSON or SSE.
 * Combines:
 *   - client heartbeat timeout (silence > timeoutMs → reconnect)
 *   - exponential / full-jitter backoff via reconnectDelayMs
 *   - Last-Event-ID resume (header + query + body field)
 *
 * @param {object} opts
 * @param {string} opts.url
 * @param {string} [opts.method="POST"]
 * @param {object|string|null} [opts.body]  JSON body or raw string
 * @param {Record<string,string>} [opts.headers]
 * @param {"ndjson"|"sse"|"auto"} [opts.format="auto"]
 * @param {(row: object) => void} [opts.onEvent]
 * @param {(status: string, info?: object) => void} [opts.onStatus]
 * @param {(err: Error) => void} [opts.onError]
 * @param {number} [opts.heartbeatMs=15000]  expected server ping interval
 * @param {number} [opts.timeoutMs]  silence timeout (default 2 * heartbeatMs)
 * @param {number} [opts.baseMs=1000]
 * @param {number} [opts.maxMs=30000]
 * @param {string} [opts.strategy="full"]
 * @param {number} [opts.maxAttempts=0]  0 = infinite
 * @param {string} [opts.lastEventId]
 * @param {AbortSignal} [opts.signal]
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {{
 *   start: () => Promise<void>,
 *   close: () => void,
 *   getLastEventId: () => string,
 *   getAttempt: () => number,
 *   getStatus: () => string,
 * }}
 */
export function createStreamReconnector(opts) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch not available");
  }

  const heartbeatMs = opts.heartbeatMs ?? 15_000;
  const timeoutMs = opts.timeoutMs ?? heartbeatMs * 2;
  const maxAttempts = opts.maxAttempts == null ? 0 : Number(opts.maxAttempts);
  const method = (opts.method || "POST").toUpperCase();
  const formatPref = opts.format || "auto";

  let closed = false;
  let attempt = 0;
  let lastEventId = opts.lastEventId ? String(opts.lastEventId) : "";
  let status = "idle";
  let activeAbort = null;
  let watchdog = null;
  let lastSeenAt = 0;

  const setStatus = (s, info) => {
    status = s;
    try {
      opts.onStatus?.(s, info);
    } catch {
      /* */
    }
  };

  const touch = () => {
    lastSeenAt = Date.now();
  };

  function stopWatchdog() {
    if (watchdog) {
      clearInterval(watchdog);
      watchdog = null;
    }
  }

  function startWatchdog(sessionAbort) {
    stopWatchdog();
    touch();
    watchdog = setInterval(() => {
      if (closed) return;
      if (Date.now() - lastSeenAt > timeoutMs) {
        const err = new Error(`heartbeat_timeout after ${timeoutMs}ms silence`);
        err.code = "HEARTBEAT_TIMEOUT";
        try {
          sessionAbort.abort(err);
        } catch {
          try {
            sessionAbort.abort();
          } catch {
            /* */
          }
        }
      }
    }, Math.min(1000, Math.max(250, timeoutMs / 4)));
    if (typeof watchdog.unref === "function") watchdog.unref();
  }

  function buildUrl() {
    if (!lastEventId) return opts.url;
    try {
      const u = new URL(opts.url, "http://localhost");
      u.searchParams.set("lastEventId", lastEventId);
      // Preserve absolute URLs
      if (/^https?:/i.test(opts.url)) {
        return u.toString();
      }
      return u.pathname + u.search + u.hash;
    } catch {
      const sep = opts.url.includes("?") ? "&" : "?";
      return `${opts.url}${sep}lastEventId=${encodeURIComponent(lastEventId)}`;
    }
  }

  function buildBody() {
    if (opts.body == null) return null;
    if (typeof opts.body === "string") return opts.body;
    const base = { ...opts.body };
    if (lastEventId && base.lastEventId == null) {
      base.lastEventId = lastEventId;
    }
    return JSON.stringify(base);
  }

  function buildHeaders(resolvedFormat) {
    const h = {
      Accept:
        resolvedFormat === "ndjson"
          ? "application/x-ndjson"
          : "text/event-stream",
      ...(opts.headers || {}),
    };
    if (lastEventId) {
      h["Last-Event-ID"] = lastEventId;
      h["X-Last-Event-ID"] = lastEventId;
    }
    if (method !== "GET" && opts.body != null && !h["Content-Type"]) {
      h["Content-Type"] = "application/json";
    }
    return h;
  }

  function detectFormat(contentType, pref) {
    if (pref === "ndjson" || pref === "sse") return pref;
    const ct = String(contentType || "");
    if (/ndjson|jsonl/i.test(ct)) return "ndjson";
    if (/event-stream/i.test(ct)) return "sse";
    // Prefer ndjson if Accept asked for it in headers
    const acc = String(opts.headers?.Accept || opts.headers?.accept || "");
    if (/ndjson|jsonl/i.test(acc)) return "ndjson";
    return "sse";
  }

  function handleNdjsonLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let row;
    try {
      row = JSON.parse(trimmed);
    } catch {
      return;
    }
    touch();
    if (row.id != null) lastEventId = String(row.id);
    if (row.event === "ping") return; // keepalive only
    opts.onEvent?.(row);
  }

  function handleSSEBlock(block) {
    const { event, data, id } = parseSSEBlock(block);
    if (!event && !data && !id) return;
    // Comment-only blocks still count as activity if we got socket data;
    // parseSSEBlock skips comments so empty means comment/ping — already touched on read
    if (id) lastEventId = String(id);
    if (event === "ping") return;
    let parsed = data;
    try {
      parsed = data ? JSON.parse(data) : {};
    } catch {
      parsed = { raw: data };
    }
    const row =
      parsed && typeof parsed === "object"
        ? { event, id: id || lastEventId, ...parsed }
        : { event, id: id || lastEventId, data: parsed };
    opts.onEvent?.(row);
  }

  async function readStream(res, sessionAbort) {
    const signal = sessionAbort.signal;
    const resolvedFormat = detectFormat(
      res.headers?.get?.("content-type") || res.headers?.get?.("Content-Type"),
      formatPref
    );
    setStatus("live", { format: resolvedFormat, attempt });

    if (!res.body || typeof res.body.getReader !== "function") {
      // Non-streaming fallback: whole text
      const text = await res.text();
      touch();
      if (resolvedFormat === "ndjson") {
        for (const line of text.split("\n")) handleNdjsonLine(line);
      } else {
        for (const block of text.split("\n\n")) handleSSEBlock(block);
      }
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    startWatchdog(sessionAbort);

    const readNext = () =>
      new Promise((resolve, reject) => {
        if (signal.aborted) {
          const e = signal.reason;
          reject(e instanceof Error ? e : new Error("aborted"));
          return;
        }
        const onAbort = () => {
          const e = signal.reason;
          reject(e instanceof Error ? e : new Error("aborted"));
          try {
            reader.cancel(e || "aborted");
          } catch {
            /* */
          }
        };
        signal.addEventListener("abort", onAbort, { once: true });
        reader.read().then(
          (v) => {
            signal.removeEventListener("abort", onAbort);
            resolve(v);
          },
          (err) => {
            signal.removeEventListener("abort", onAbort);
            reject(err);
          }
        );
      });

    try {
      while (true) {
        if (signal.aborted) {
          const e = signal.reason;
          throw e instanceof Error ? e : new Error("aborted");
        }
        const { done, value } = await readNext();
        if (done) break;
        touch();
        buf += decoder.decode(value, { stream: true });

        if (resolvedFormat === "ndjson") {
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const line of lines) handleNdjsonLine(line);
        } else {
          const parts = buf.split("\n\n");
          buf = parts.pop() || "";
          for (const block of parts) handleSSEBlock(block);
        }
      }
      // flush remainder
      if (buf.trim()) {
        if (resolvedFormat === "ndjson") handleNdjsonLine(buf);
        else handleSSEBlock(buf);
      }
    } finally {
      stopWatchdog();
      try {
        reader.releaseLock?.();
      } catch {
        /* */
      }
    }
  }

  async function oneAttempt() {
    const sessionAbort = new AbortController();
    activeAbort = sessionAbort;

    const onOuterAbort = () => {
      try {
        sessionAbort.abort(opts.signal.reason || new Error("aborted"));
      } catch {
        /* */
      }
    };
    if (opts.signal) {
      if (opts.signal.aborted) onOuterAbort();
      else opts.signal.addEventListener("abort", onOuterAbort, { once: true });
    }

    const url = buildUrl();
    const headers = buildHeaders(
      formatPref === "auto" ? "sse" : formatPref
    );
    // If auto, send Accept that allows both
    if (formatPref === "auto") {
      headers.Accept =
        "application/x-ndjson, text/event-stream, application/jsonl";
    }

    setStatus(attempt === 0 ? "connecting" : `reconnecting`, {
      attempt,
      lastEventId: lastEventId || null,
    });

    const init = {
      method,
      headers,
      signal: sessionAbort.signal,
    };
    const body = buildBody();
    if (body != null && method !== "GET" && method !== "HEAD") {
      init.body = body;
    }

    let res;
    try {
      res = await fetchImpl(url, init);
    } catch (err) {
      if (sessionAbort.signal.aborted && err?.code === "HEARTBEAT_TIMEOUT") {
        throw err;
      }
      if (sessionAbort.signal.aborted) {
        const e = new Error("aborted");
        e.code = "ABORTED";
        throw e;
      }
      throw err;
    }

    if (!res.ok) {
      const err = new Error(`stream HTTP ${res.status}`);
      err.status = res.status;
      err.code = res.status === 429 || res.status >= 500 ? "TRANSIENT" : "FATAL";
      // Best-effort Retry-After
      const ra = res.headers?.get?.("retry-after");
      if (ra != null) err.retryAfter = ra;
      throw err;
    }

    await readStream(res, sessionAbort);
  }

  function isRetryable(err) {
    if (!err) return true;
    if (err.code === "HEARTBEAT_TIMEOUT") return true;
    if (err.code === "TRANSIENT") return true;
    if (err.code === "ABORTED" && opts.signal?.aborted) return false;
    if (err.name === "AbortError" && opts.signal?.aborted) return false;
    const status = err.status;
    if (status === 401 || status === 403 || status === 404 || status === 400) {
      return false;
    }
    if (status === 429 || (status >= 500 && status <= 599)) return true;
    // network errors
    if (/network|fetch|ECONN|ETIMEDOUT|ENOTFOUND|socket/i.test(String(err.message || err))) {
      return true;
    }
    return true; // stream drops are usually retryable
  }

  async function start() {
    if (closed) return;
    let prevDelayMs = opts.baseMs ?? 1000;

    while (!closed) {
      if (opts.signal?.aborted) {
        setStatus("closed");
        return;
      }
      try {
        await oneAttempt();
        // Clean completion (server ended stream)
        attempt = 0;
        setStatus("ended");
        return;
      } catch (err) {
        stopWatchdog();
        try {
          opts.onError?.(err instanceof Error ? err : new Error(String(err)));
        } catch {
          /* */
        }

        if (closed || opts.signal?.aborted) {
          setStatus("closed");
          return;
        }
        if (!isRetryable(err)) {
          setStatus("failed", { error: String(err.message || err) });
          throw err;
        }
        if (maxAttempts > 0 && attempt >= maxAttempts) {
          setStatus("failed", { error: "max_attempts" });
          throw err;
        }

        const delay = reconnectDelayMs(attempt, {
          baseMs: opts.baseMs ?? 1000,
          maxMs: opts.maxMs ?? 30_000,
          strategy: opts.strategy || "full",
          // decorrelated continuity if strategy is decorrelated — reconnectDelayMs uses full by default
        });
        prevDelayMs = delay;
        attempt += 1;
        setStatus("backoff", { attempt, delayMs: delay, error: String(err.message || err) });
        try {
          await sleepMs(delay, opts.signal);
        } catch {
          setStatus("closed");
          return;
        }
      }
    }
  }

  function close() {
    closed = true;
    stopWatchdog();
    try {
      activeAbort?.abort(new Error("closed"));
    } catch {
      /* */
    }
    setStatus("closed");
  }

  return {
    start,
    close,
    getLastEventId: () => lastEventId,
    getAttempt: () => attempt,
    getStatus: () => status,
  };
}


export default {
  eventsAfterLastId,
  reconnectDelayMs,
  formatSSEEvent,
  createEventSourceReconnect,
  createStreamReconnector,
  sleepMs,
  parseSSEBlock,
};

