/**
 * SSE multi-subscriber fanout — ordered events, no cross-talk between rooms.
 */
import { sendSSE, isSSEOpen } from "./sse.mjs";

/**
 * Create a fanout hub.
 * Rooms isolate events (sessionId / jobId / streamId).
 */
export function createSSEFanout() {
  /** @type {Map<string, Map<string, object>>} */
  const rooms = new Map();
  let globalSeq = 0;
  let subSeq = 0;

  function roomMap(room) {
    const key = String(room || "default");
    if (!rooms.has(key)) rooms.set(key, new Map());
    return rooms.get(key);
  }

  function subscribe(room, res, opts = {}) {
    const id = opts.id || `sub_${++subSeq}`;
    const r = roomMap(room);
    const sub = { id, room: String(room || "default"), res, seq: 0 };
    r.set(id, sub);
    if (opts.hello !== false) {
      sendSSE(res, "subscribed", { room: sub.room, subId: id }, `sub-${id}`);
    }
    return {
      id,
      room: sub.room,
      unsubscribe() {
        r.delete(id);
        if (r.size === 0) rooms.delete(sub.room);
      },
    };
  }

  function publish(room, event, data) {
    const r = roomMap(room);
    const id = ++globalSeq;
    let delivered = 0;
    const dead = [];
    for (const [sid, sub] of r.entries()) {
      if (!isSSEOpen(sub.res)) {
        dead.push(sid);
        continue;
      }
      sub.seq += 1;
      const ok = sendSSE(sub.res, event, data, id);
      if (ok) delivered += 1;
      else dead.push(sid);
    }
    for (const sid of dead) r.delete(sid);
    if (r.size === 0) rooms.delete(String(room || "default"));
    return { delivered, eventId: id, room: String(room || "default") };
  }

  function publishAll(event, data) {
    const results = [];
    for (const room of [...rooms.keys()]) {
      results.push(publish(room, event, data));
    }
    return results;
  }

  function stats() {
    const out = {};
    for (const [room, map] of rooms) {
      out[room] = map.size;
    }
    return {
      rooms: out,
      subscribers: [...rooms.values()].reduce((n, m) => n + m.size, 0),
    };
  }

  function clear() {
    rooms.clear();
  }

  return { subscribe, publish, publishAll, stats, clear };
}

/**
 * In-memory mock ServerResponse for tests (captures SSE writes).
 */
export function createMockSSEResponse() {
  const chunks = [];
  let ended = false;
  const res = {
    writableEnded: false,
    destroyed: false,
    writable: true,
    writeHead() {},
    flushHeaders() {},
    write(chunk) {
      if (ended || res.destroyed) throw new Error("write after end");
      chunks.push(String(chunk));
      return true;
    },
    end() {
      ended = true;
      res.writableEnded = true;
    },
    destroy() {
      res.destroyed = true;
      res.writable = false;
    },
  };
  return {
    res,
    chunks,
    text() {
      return chunks.join("");
    },
    events() {
      const text = chunks.join("");
      const parts = text.split("\n\n").filter(Boolean);
      const evs = [];
      for (const p of parts) {
        if (p.startsWith(":")) continue;
        const event = (p.match(/^event: (.+)$/m) || [])[1];
        const id = (p.match(/^id: (.+)$/m) || [])[1];
        const dataLines = p
          .split("\n")
          .filter((l) => l.startsWith("data: "))
          .map((l) => l.slice(6));
        const dataRaw = dataLines.join("\n");
        let data = dataRaw;
        try {
          data = JSON.parse(dataRaw);
        } catch {
          /* */
        }
        if (event || dataRaw) evs.push({ event, id, data });
      }
      return evs;
    },
  };
}

export default { createSSEFanout, createMockSSEResponse };
