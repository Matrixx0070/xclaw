/**
 * Minimal JSON WebSocket hub for XClaw gateway real-time updates.
 * Zero dependencies — RFC6455 text frames only.
 *
 * Path: GET /ws/events (Upgrade: websocket)
 *
 * Client → server:
 *   { "type": "subscribe", "channels": ["admission","queue","eviction","swarm","all"] }
 *   { "type": "ping" }
 *
 * Server → client:
 *   { "type": "ready", "channels": [...] }
 *   { "type": "event", "channel": "admission"|"queue"|"eviction"|"swarm", "data": {...}, "at": ISO }
 *   { "type": "pong", "t": number }
 */
import { redactEvent } from "../security/redact-secrets.mjs";


import crypto from "node:crypto";
import { createBoundedQueue, DropPolicy } from "../shared/bounded-queue.mjs";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const clients = new Set();
const DEFAULT_OUTBOUND_MAX = 64;
const outboundStats = { dropped: 0, enqueued: 0, written: 0 };

function acceptKey(secKey) {
  return crypto.createHash("sha1").update(secKey + GUID).digest("base64");
}

/** Encode a binary WebSocket frame */
export function encodeBinaryFrame(buf) {
  const payload = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x82; // FIN + binary
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x82;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x82;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, payload]);
}

/** Encode a text WebSocket frame */
export function encodeTextFrame(str) {
  const payload = Buffer.from(str, "utf8");
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, payload]);
}

const DEFAULT_MAX_MESSAGE_BYTES = 1_000_000; // matches the gateway HTTP body cap
const utf8Strict = new TextDecoder("utf-8", { fatal: true });

/**
 * Stateful RFC6455 frame parser (server side).
 *
 * Handles: frames split across TCP chunks, multiple frames per chunk,
 * fragmentation (continuation frames, interleaved control frames), safe
 * 64-bit lengths (rejected above the cap BEFORE buffering), client-mask
 * enforcement, control-frame rules (FIN required, payload ≤125), RSV bits,
 * unknown opcodes, close codes, and strict UTF-8 on text messages.
 *
 * push(chunk) → { messages, error }. `error` is {code, reason} — after an
 * error the parser is dead and further pushes return nothing. Garbage input
 * can only ever produce an error, never a throw.
 *
 * @param {{ maxMessageBytes?: number, requireMask?: boolean }} [opts]
 */
export function createFrameParser(opts = {}) {
  const maxMessageBytes = Number(opts.maxMessageBytes) || DEFAULT_MAX_MESSAGE_BYTES;
  const requireMask = opts.requireMask !== false;
  let buf = Buffer.alloc(0);
  let dead = false;
  /** open fragmented message: { opcode, chunks, size } | null */
  let fragment = null;

  function fail(code, reason) {
    dead = true;
    buf = Buffer.alloc(0);
    fragment = null;
    return { code, reason };
  }

  function push(chunk) {
    const messages = [];
    if (dead) return { messages, error: null };
    buf = buf.length ? Buffer.concat([buf, chunk]) : Buffer.from(chunk);

    while (buf.length >= 2) {
      const b0 = buf[0];
      const b1 = buf[1];
      const fin = (b0 & 0x80) !== 0;
      const rsv = b0 & 0x70;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let hdr = 2;

      if (rsv !== 0) {
        return { messages, error: fail(1002, "nonzero RSV bits (no extension negotiated)") };
      }
      const isControl = (opcode & 0x8) !== 0;
      if (isControl) {
        if (!fin) return { messages, error: fail(1002, "fragmented control frame") };
        if (payloadLen > 125) return { messages, error: fail(1002, "control frame payload > 125") };
        if (opcode !== 0x8 && opcode !== 0x9 && opcode !== 0xa) {
          return { messages, error: fail(1002, `unknown control opcode 0x${opcode.toString(16)}`) };
        }
      } else if (opcode !== 0x0 && opcode !== 0x1 && opcode !== 0x2) {
        return { messages, error: fail(1002, `unknown opcode 0x${opcode.toString(16)}`) };
      }
      if (requireMask && !masked) {
        return { messages, error: fail(1002, "client frame not masked") };
      }

      if (payloadLen === 126) {
        if (buf.length < 4) break;
        payloadLen = buf.readUInt16BE(2);
        hdr = 4;
      } else if (payloadLen === 127) {
        if (buf.length < 10) break;
        const big = buf.readBigUInt64BE(2);
        // Reject the claimed size BEFORE waiting for (or buffering) the bytes.
        if (big > BigInt(maxMessageBytes)) {
          return { messages, error: fail(1009, `frame of ${big} bytes exceeds ${maxMessageBytes}`) };
        }
        payloadLen = Number(big);
        hdr = 10;
      }
      if (payloadLen > maxMessageBytes) {
        return { messages, error: fail(1009, `frame of ${payloadLen} bytes exceeds ${maxMessageBytes}`) };
      }

      const maskLen = masked ? 4 : 0;
      const total = hdr + maskLen + payloadLen;
      if (buf.length < total) break; // wait for more bytes (bounded: payloadLen ≤ cap)

      let payload = buf.subarray(hdr + maskLen, total);
      if (masked) {
        const mask = buf.subarray(hdr, hdr + 4);
        const out = Buffer.alloc(payloadLen);
        for (let i = 0; i < payloadLen; i++) out[i] = payload[i] ^ mask[i % 4];
        payload = out;
      } else {
        payload = Buffer.from(payload); // detach from the shared buffer
      }
      buf = buf.subarray(total);

      if (isControl) {
        if (opcode === 0x8) {
          let code = 1000;
          let reason = "";
          if (payload.length === 1) {
            return { messages, error: fail(1002, "close frame with 1-byte payload") };
          }
          if (payload.length >= 2) {
            code = payload.readUInt16BE(0);
            reason = payload.subarray(2).toString("utf8");
            if (code < 1000 || code > 4999) code = 1002;
          }
          messages.push({ type: "close", code, reason });
        } else if (opcode === 0x9) {
          messages.push({ type: "ping", data: payload });
        } else {
          messages.push({ type: "pong", data: payload });
        }
        continue;
      }

      // Data frames — fragmentation state machine.
      if (opcode === 0x0) {
        if (!fragment) return { messages, error: fail(1002, "continuation without open fragment") };
        fragment.size += payload.length;
        if (fragment.size > maxMessageBytes) {
          return { messages, error: fail(1009, `fragmented message exceeds ${maxMessageBytes}`) };
        }
        fragment.chunks.push(payload);
        if (fin) {
          const whole = Buffer.concat(fragment.chunks);
          const kind = fragment.opcode;
          fragment = null;
          const out = finishData(kind, whole, messages);
          if (out) return { messages, error: out };
        }
        continue;
      }
      if (fragment) {
        return { messages, error: fail(1002, "new data frame while fragment open") };
      }
      if (!fin) {
        fragment = { opcode, chunks: [payload], size: payload.length };
        continue;
      }
      const out = finishData(opcode, payload, messages);
      if (out) return { messages, error: out };
    }
    return { messages, error: null };
  }

  function finishData(opcode, payload, messages) {
    if (opcode === 0x1) {
      let text;
      try {
        text = utf8Strict.decode(payload);
      } catch {
        return fail(1007, "invalid UTF-8 in text message");
      }
      messages.push({ type: "text", data: text });
    } else {
      messages.push({ type: "binary", data: payload });
    }
    return null;
  }

  return {
    push,
    get dead() {
      return dead;
    },
  };
}

/**
 * Legacy one-shot decode; returns { messages, rest }.
 * Accepts unmasked frames (server→client direction) — mask enforcement lives
 * in the per-connection parser, not here. On a protocol error it stops and
 * returns what was decoded so far.
 */
export function decodeFrames(buf) {
  const parser = createFrameParser({ requireMask: false });
  const { messages } = parser.push(buf);
  const rest = parser.dead ? Buffer.alloc(0) : buf.subarray(buf.length - unconsumedTail(buf));
  return { messages, rest };
}

/** Internal: bytes after the last complete frame (legacy `rest` semantics). */
function unconsumedTail(buf) {
  let offset = 0;
  while (offset + 2 <= buf.length) {
    const b1 = buf[offset + 1];
    const masked = (b1 & 0x80) !== 0;
    let payloadLen = b1 & 0x7f;
    let hdr = 2;
    if (payloadLen === 126) {
      if (offset + 4 > buf.length) break;
      payloadLen = buf.readUInt16BE(offset + 2);
      hdr = 4;
    } else if (payloadLen === 127) {
      if (offset + 10 > buf.length) break;
      const big = buf.readBigUInt64BE(offset + 2);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) break;
      payloadLen = Number(big);
      hdr = 10;
    }
    const total = hdr + (masked ? 4 : 0) + payloadLen;
    if (offset + total > buf.length) break;
    offset += total;
  }
  return buf.length - offset;
}

function sendJson(socket, obj) {
  if (!socket || socket.destroyed) return false;
  try {
    socket.write(encodeTextFrame(JSON.stringify(redactEvent(obj))));
    return true;
  } catch {
    return false;
  }
}

/** Enqueue pre-encoded frame; drop_oldest when full. Control frames use sendJson. */
function enqueueFrame(client, frame) {
  if (!client.outbound) {
    client.outbound = createBoundedQueue({
      maxsize: client.outboundMax || DEFAULT_OUTBOUND_MAX,
      policy: DropPolicy.DROP_OLDEST,
    });
  }
  const before = client.outbound.metrics.dropped;
  const ok = client.outbound.push(frame);
  outboundStats.enqueued += 1;
  const after = client.outbound.metrics.dropped;
  if (after > before) outboundStats.dropped += after - before;
  flushOutbound(client);
  return ok;
}

function flushOutbound(client) {
  if (!client?.socket || client.socket.destroyed || !client.outbound) return;
  while (client.outbound.size > 0) {
    const frame = client.outbound.peek();
    try {
      const wrote = client.socket.write(frame);
      client.outbound.shift();
      outboundStats.written += 1;
      if (!wrote) {
        if (!client._drainBound) {
          client._drainBound = true;
          client.socket.once("drain", () => {
            client._drainBound = false;
            flushOutbound(client);
          });
        }
        break;
      }
    } catch {
      break;
    }
  }
}

/**
 * Send a close frame (code + optional reason ≤123 bytes) once, then destroy —
 * immediately by default, or after a short grace so the peer can read the
 * frame and echo its own close (RFC close handshake).
 */
export function sendClose(socket, code = 1000, reason = "", { graceMs = 0 } = {}) {
  if (!socket || socket.destroyed) return;
  if (!socket._xclawCloseSent) {
    socket._xclawCloseSent = true;
    try {
      const reasonBuf = Buffer.from(String(reason || ""), "utf8").subarray(0, 123);
      const payload = Buffer.alloc(2 + reasonBuf.length);
      payload.writeUInt16BE(code, 0);
      reasonBuf.copy(payload, 2);
      socket.write(Buffer.concat([Buffer.from([0x88, payload.length]), payload]));
    } catch {
      /* */
    }
  }
  const destroy = () => {
    try {
      socket.destroy();
    } catch {
      /* */
    }
  };
  if (graceMs > 0) {
    const t = setTimeout(destroy, graceMs);
    if (t.unref) t.unref();
    socket.once("close", () => clearTimeout(t));
  } else {
    destroy();
  }
}

/**
 * Attach upgrade handler to an http(s) server.
 * @param {import('http').Server} server
 * @param {{ path?: string, heartbeatMs?: number }} [opts]
 */

/** @type {ReturnType<typeof attachWebSocketHub>|null} */
let activeHub = null;

export function getActiveWsHub() {
  return activeHub;
}

export function closeAllWebSockets(reason = "kill_all") {
  if (!activeHub) return { ok: true, closed: 0, reason };
  const n = activeHub.clientCount?.() ?? 0;
  try {
    activeHub.closeAll();
  } catch {
    /* */
  }
  activeHub = null;
  return { ok: true, closed: n, reason };
}

export function attachWebSocketHub(server, opts = {}) {
  const path = opts.path || "/ws/events";
  const heartbeatMs = Math.max(1000, Number(opts.heartbeatMs) || 25_000);
  const maxMessageBytes = Number(opts.maxMessageBytes) || DEFAULT_MAX_MESSAGE_BYTES;
  /** @type {(req) => {ok:boolean, protocol?:string, error?:string}} */
  const authorize = typeof opts.authorize === "function" ? opts.authorize : null;
  const cfg = opts.cfg || {};
  const missThreshold = Math.max(1, Number(opts.missThreshold) || 2);
  const stats = {
    pingsSent: 0,
    pongsRecv: 0,
    deadClosed: 0,
    connected: 0,
  };
  let seq = 0;

  function touch(client) {
    client.alive = true;
    client.lastPongAt = Date.now();
    client.misses = 0;
  }

  function dropClient(client, reason = "close") {
    if (!clients.has(client)) return;
    clients.delete(client);
    try {
      sendClose(client.socket);
    } catch {
      try {
        client.socket.destroy();
      } catch {
        /* */
      }
    }
    if (reason === "heartbeat") stats.deadClosed += 1;
  }

  server.on("upgrade", (req, socket, head) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      // Leave socket alone so other upgrade handlers (e.g. /ws/voice) can claim it
      if (url.pathname !== path) {
        return;
      }
      const key = req.headers["sec-websocket-key"];
      if (!key || String(req.headers.upgrade || "").toLowerCase() !== "websocket") {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }
      // Auth gate BEFORE the 101 handshake — reject unauthorized upgrades.
      let authProtocol;
      if (authorize) {
        let verdict;
        try {
          verdict = authorize(req);
        } catch (err) {
          verdict = { ok: false, error: err?.message || "authorize error" };
        }
        if (!verdict?.ok) {
          stats.rejected = (stats.rejected || 0) + 1;
          socket.write(
            "HTTP/1.1 401 Unauthorized\r\n" +
              "Connection: close\r\n" +
              "Content-Length: 0\r\n" +
              "\r\n"
          );
          socket.destroy();
          return;
        }
        authProtocol = verdict.protocol;
      }
      const accept = acceptKey(String(key).trim());
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n` +
          // Echo the token subprotocol so browser clients complete the handshake
          (authProtocol ? `Sec-WebSocket-Protocol: ${authProtocol}\r\n` : "") +
          "\r\n"
      );

      const client = {
        socket,
        channels: new Set(["all"]),
        parser: createFrameParser({ maxMessageBytes, requireMask: true }),
        alive: true,
        misses: 0,
        lastPongAt: Date.now(),
        connectedAt: Date.now(),
        outboundMax: Number(opts.outboundMax) > 0 ? Number(opts.outboundMax) : DEFAULT_OUTBOUND_MAX,
        outbound: null,
        _drainBound: false,
      };
      clients.add(client);
      stats.connected += 1;

      sendJson(socket, {
        type: "ready",
        channels: [...client.channels],
        path,
        heartbeatMs,
        missThreshold,
        at: new Date().toISOString(),
      });

      const onBytes = (chunk) => {
        let messages, error;
        try {
          ({ messages, error } = client.parser.push(chunk));
        } catch {
          // Fuzz-safety belt: the parser must not throw, but if it ever does,
          // fail the connection rather than the gateway process.
          messages = [];
          error = { code: 1002, reason: "frame parse failure" };
        }
        for (const msg of messages) {
          // any traffic counts as liveness
          touch(client);

          if (msg.type === "close") {
            // Close handshake: echo the peer's code, then tear down.
            clients.delete(client);
            sendClose(socket, msg.code || 1000, "", { graceMs: 250 });
            return;
          }
          if (msg.type === "ping") {
            try {
              const payload = msg.data || Buffer.alloc(0); // parser enforces ≤125
              socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
            } catch {
              /* */
            }
            continue;
          }
          if (msg.type === "pong") {
            stats.pongsRecv += 1;
            continue;
          }
          if (msg.type !== "text") continue;
          let body;
          try {
            body = JSON.parse(msg.data);
          } catch {
            continue;
          }
          if (body.type === "ping") {
            sendJson(socket, { type: "pong", t: Date.now(), seq: body.seq });
          } else if (body.type === "pong") {
            stats.pongsRecv += 1;
            // touch already applied
          } else if (body.type === "subscribe" && Array.isArray(body.channels)) {
            client.channels = new Set(body.channels.map(String));
            sendJson(socket, {
              type: "subscribed",
              channels: [...client.channels],
              at: new Date().toISOString(),
            });
          } else if (
            body.type === "stop" ||
            body.type === "stop-all" ||
            body.type === "stop_all" ||
            body.type === "kill_switch"
          ) {
            import("./ws-stop-control.mjs")
              .then(({ handleWsStopControl }) =>
                handleWsStopControl(body, cfg, (payload) => sendJson(socket, payload))
              )
              .catch((e) => {
                try {
                  sendJson(socket, {
                    type: "stop_result",
                    ok: false,
                    error: e.message || String(e),
                  });
                } catch {
                  /* */
                }
              });
          }
        }
        if (error) {
          // Protocol violation: close with the parser's code, then destroy
          // after a short grace. Malformed bytes can never crash the gateway.
          clients.delete(client);
          sendClose(socket, error.code, error.reason, { graceMs: 250 });
        }
      };

      socket.on("data", onBytes);
      if (head && head.length) onBytes(head);

      socket.on("close", () => dropClient(client, "close"));
      socket.on("error", () => dropClient(client, "error"));
    } catch {
      try {
        socket.destroy();
      } catch {
        /* */
      }
    }
  });

  const hb = setInterval(() => {
    const now = Date.now();
    for (const c of [...clients]) {
      if (!c.alive) {
        c.misses = (c.misses || 0) + 1;
        if (c.misses >= missThreshold) {
          dropClient(c, "heartbeat");
          continue;
        }
      }
      // mark not-alive until next pong/traffic
      c.alive = false;
      seq += 1;
      const ok = sendJson(c.socket, { type: "ping", t: now, seq });
      stats.pingsSent += 1;
      if (!ok) dropClient(c, "write_fail");
    }
  }, heartbeatMs);
  if (typeof hb.unref === "function") hb.unref();

  const hub = {
    path,
    heartbeatMs,
    missThreshold,
    clientCount: () => clients.size,
    heartbeatStats: () => ({ ...stats, clients: clients.size, seq }),
    broadcast,
    closeAll() {
      for (const c of [...clients]) {
        dropClient(c, "shutdown");
      }
      clients.clear();
      clearInterval(hb);
      if (activeHub === hub) activeHub = null;
    },
  };
  activeHub = hub;
  return hub;
}

/**
 * Broadcast an event to subscribed clients.
 * @param {string} channel
 * @param {object} data
 */
export function broadcast(channel, data) {
  const ch = String(channel || "all");
  const envelope = {
    type: "event",
    channel: ch,
    data: redactEvent(data),
    at: new Date().toISOString(),
  };
  const frame = encodeTextFrame(JSON.stringify(envelope));
  for (const c of clients) {
    if (c.channels.has("all") || c.channels.has(ch)) {
      try {
        if (!c.socket.destroyed) enqueueFrame(c, frame);
      } catch {
        clients.delete(c);
      }
    }
  }
  return clients.size;
}

export function wsClientCount() {
  return clients.size;
}

/** Outbound buffer metrics (hub-wide). */
export function wsOutboundStats() {
  return { ...outboundStats, clients: clients.size };
}

export default { attachWebSocketHub, broadcast, wsClientCount, wsOutboundStats, encodeTextFrame, encodeBinaryFrame, decodeFrames, createFrameParser, getActiveWsHub, closeAllWebSockets };
