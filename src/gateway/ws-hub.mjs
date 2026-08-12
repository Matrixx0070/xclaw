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

import crypto from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const clients = new Set();

function acceptKey(secKey) {
  return crypto.createHash("sha1").update(secKey + GUID).digest("base64");
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

/** Decode frames from a buffer; returns { messages, rest } */
export function decodeFrames(buf) {
  const messages = [];
  let offset = 0;
  while (offset + 2 <= buf.length) {
    const b0 = buf[offset];
    const b1 = buf[offset + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let payloadLen = b1 & 0x7f;
    let hdr = 2;
    if (payloadLen === 126) {
      if (offset + 4 > buf.length) break;
      payloadLen = buf.readUInt16BE(offset + 2);
      hdr = 4;
    } else if (payloadLen === 127) {
      if (offset + 10 > buf.length) break;
      payloadLen = Number(buf.readBigUInt64BE(offset + 2));
      hdr = 10;
    }
    const maskLen = masked ? 4 : 0;
    if (offset + hdr + maskLen + payloadLen > buf.length) break;
    let payload = buf.subarray(offset + hdr + maskLen, offset + hdr + maskLen + payloadLen);
    if (masked) {
      const mask = buf.subarray(offset + hdr, offset + hdr + 4);
      const out = Buffer.alloc(payloadLen);
      for (let i = 0; i < payloadLen; i++) out[i] = payload[i] ^ mask[i % 4];
      payload = out;
    }
    offset += hdr + maskLen + payloadLen;
    if (opcode === 0x8) {
      messages.push({ type: "close" });
    } else if (opcode === 0x9) {
      messages.push({ type: "ping", data: payload });
    } else if (opcode === 0xa) {
      messages.push({ type: "pong" });
    } else if (opcode === 0x1) {
      messages.push({ type: "text", data: payload.toString("utf8") });
    }
  }
  return { messages, rest: buf.subarray(offset) };
}

function sendJson(socket, obj) {
  if (!socket || socket.destroyed) return false;
  try {
    socket.write(encodeTextFrame(JSON.stringify(obj)));
    return true;
  } catch {
    return false;
  }
}

function sendClose(socket, code = 1000) {
  try {
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code, 0);
    const header = Buffer.from([0x88, 0x02]);
    socket.write(Buffer.concat([header, payload]));
  } catch {
    /* */
  }
  try {
    socket.destroy();
  } catch {
    /* */
  }
}

/**
 * Attach upgrade handler to an http(s) server.
 * @param {import('http').Server} server
 * @param {{ path?: string, heartbeatMs?: number }} [opts]
 */
export function attachWebSocketHub(server, opts = {}) {
  const path = opts.path || "/ws/events";
  const heartbeatMs = Math.max(1000, Number(opts.heartbeatMs) || 25_000);
  /** @type {(req) => {ok:boolean, protocol?:string, error?:string}} */
  const authorize = typeof opts.authorize === "function" ? opts.authorize : null;
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
      if (url.pathname !== path) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
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
        buf: Buffer.alloc(0),
        alive: true,
        misses: 0,
        lastPongAt: Date.now(),
        connectedAt: Date.now(),
      };
      clients.add(client);
      stats.connected += 1;

      if (head && head.length) {
        client.buf = Buffer.concat([client.buf, head]);
      }

      sendJson(socket, {
        type: "ready",
        channels: [...client.channels],
        path,
        heartbeatMs,
        missThreshold,
        at: new Date().toISOString(),
      });

      socket.on("data", (chunk) => {
        client.buf = Buffer.concat([client.buf, chunk]);
        const { messages, rest } = decodeFrames(client.buf);
        client.buf = rest;
        for (const msg of messages) {
          // any traffic counts as liveness
          touch(client);

          if (msg.type === "close") {
            dropClient(client, "close");
            return;
          }
          if (msg.type === "ping") {
            try {
              const payload = msg.data || Buffer.alloc(0);
              const header = Buffer.alloc(2);
              header[0] = 0x8a;
              header[1] = payload.length < 126 ? payload.length : 0;
              if (payload.length < 126) {
                socket.write(Buffer.concat([header, payload]));
              } else {
                // oversized control payload — ignore
              }
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
          }
        }
      });

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

  return {
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
    },
  };
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
    data,
    at: new Date().toISOString(),
  };
  const frame = encodeTextFrame(JSON.stringify(envelope));
  for (const c of clients) {
    if (c.channels.has("all") || c.channels.has(ch)) {
      try {
        if (!c.socket.destroyed) c.socket.write(frame);
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

export default { attachWebSocketHub, broadcast, wsClientCount, encodeTextFrame, decodeFrames };
