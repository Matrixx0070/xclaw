/**
 * In-memory ring buffer + SSE fan-out for live eviction events.
 * Supports Last-Event-ID / ?lastEventId= resume.
 */
import { eventsAfterLastId, formatSSEEvent } from "../utils/sse-reconnect.mjs";

const MAX = 100;
const recent = [];
const listeners = new Set();

export function pushEvictionEvent(event) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    ...event,
  };
  recent.push(entry);
  while (recent.length > MAX) recent.shift();
  const chunk = formatSSEEvent("eviction", entry, entry.id);
  for (const res of listeners) {
    try {
      if (!res.writableEnded) {
        res.write(chunk);
      }
    } catch {
      listeners.delete(res);
    }
  }
  try {
    const fn = globalThis.__xclawWsBroadcast;
    if (typeof fn === "function") fn("eviction", entry);
  } catch {
    /* */
  }
  return entry;
}

export function listEvictionEvents({ limit = 50 } = {}) {
  const n = Math.min(MAX, Math.max(1, Number(limit) || 50));
  return recent.slice(-n);
}

/**
 * @param {import('http').ServerResponse} res
 * @param {{ lastEventId?: string|null }} [opts]
 */
export function subscribeEvictionSSE(res, opts = {}) {
  listeners.add(res);
  res.on("close", () => listeners.delete(res));

  const lastId = opts.lastEventId || null;
  const snapshot = eventsAfterLastId(recent, lastId);
  // If no lastId, still cap initial burst
  const toSend = lastId ? snapshot : snapshot.slice(-20);

  for (const entry of toSend) {
    try {
      res.write(formatSSEEvent("eviction", entry, entry.id));
    } catch {
      listeners.delete(res);
      return;
    }
  }
  try {
    res.write(
      formatSSEEvent(
        "ready",
        {
          ok: true,
          buffered: recent.length,
          replayed: toSend.length,
          resumedFrom: lastId || null,
        },
        `ready-${Date.now()}`
      )
    );
  } catch {
    listeners.delete(res);
  }
}

export function evictionListenerCount() {
  return listeners.size;
}
