import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import net from "node:net";
import { attachWebSocketHub, createFrameParser } from "../src/gateway/ws-hub.mjs";

/** Encode a client→server frame (masked by default, per RFC). */
function clientFrame(payload, { opcode = 0x1, fin = true, masked = true } = {}) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.from([(fin ? 0x80 : 0x00) | opcode, (masked ? 0x80 : 0x00) | len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = (fin ? 0x80 : 0x00) | opcode;
    header[1] = (masked ? 0x80 : 0x00) | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = (fin ? 0x80 : 0x00) | opcode;
    header[1] = (masked ? 0x80 : 0x00) | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  if (!masked) return Buffer.concat([header, data]);
  const mask = crypto.randomBytes(4);
  const out = Buffer.alloc(len);
  for (let i = 0; i < len; i++) out[i] = data[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, out]);
}

/** Open a raw upgraded socket; resolves after the 101 with a frame collector. */
function openWs(port) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString("base64");
    const sock = net.connect(port, "127.0.0.1", () => {
      sock.write(
        [
          "GET /ws/events HTTP/1.1",
          "Host: 127.0.0.1",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "\r\n",
        ].join("\r\n")
      );
    });
    let pre = Buffer.alloc(0);
    let upgraded = false;
    const parser = createFrameParser({ requireMask: false }); // server frames are unmasked
    const received = [];
    let closed = false;
    const waiters = [];
    const check = () => {
      for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i];
        const hit = received.find(w.pred);
        if (hit) {
          waiters.splice(i, 1);
          w.resolve(hit);
        } else if (closed && w.onClose) {
          waiters.splice(i, 1);
          w.resolve(null);
        }
      }
    };
    sock.on("data", (chunk) => {
      if (!upgraded) {
        pre = Buffer.concat([pre, chunk]);
        const idx = pre.indexOf("\r\n\r\n");
        if (idx === -1) return;
        const statusLine = pre.toString("utf8", 0, pre.indexOf("\r\n"));
        if (!statusLine.includes("101")) {
          sock.destroy();
          return reject(new Error(`upgrade failed: ${statusLine}`));
        }
        upgraded = true;
        const rest = pre.subarray(idx + 4);
        pre = null;
        if (rest.length) {
          const { messages } = parser.push(rest);
          received.push(...messages);
          check();
        }
        resolve(api);
        return;
      }
      const { messages } = parser.push(chunk);
      received.push(...messages);
      check();
    });
    sock.on("close", () => {
      closed = true;
      check();
    });
    sock.on("error", () => {});
    const api = {
      sock,
      received,
      isClosed: () => closed,
      /** wait for a frame matching pred (or null if the socket closes first when onClose) */
      waitFor(pred, { timeoutMs = 3000, onClose = false } = {}) {
        const hit = received.find(pred);
        if (hit) return Promise.resolve(hit);
        if (closed && onClose) return Promise.resolve(null);
        return new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error("waitFor timeout")), timeoutMs);
          waiters.push({
            pred,
            onClose,
            resolve: (v) => {
              clearTimeout(t);
              res(v);
            },
          });
        });
      },
      waitClosed({ timeoutMs = 3000 } = {}) {
        if (closed) return Promise.resolve();
        return new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error("close timeout")), timeoutMs);
          sock.once("close", () => {
            clearTimeout(t);
            res();
          });
        });
      },
    };
    setTimeout(() => reject(new Error("upgrade timeout")), 3000);
  });
}

const isJson = (type) => (m) => {
  if (m.type !== "text") return false;
  try {
    return JSON.parse(m.data).type === type;
  } catch {
    return false;
  }
};

describe("WS protocol hardening (RFC6455, zero-dep)", () => {
  let server;
  let hub;
  let port;

  before(async () => {
    server = http.createServer((_req, res) => res.end("ok"));
    hub = attachWebSocketHub(server, { heartbeatMs: 60_000 });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });

  after(() => {
    hub.closeAll();
    server.close();
  });

  it("reassembles a frame split across TCP chunks", async () => {
    const ws = await openWs(port);
    const frame = clientFrame(JSON.stringify({ type: "ping", seq: 101 }));
    ws.sock.write(frame.subarray(0, 5));
    await new Promise((r) => setTimeout(r, 30));
    ws.sock.write(frame.subarray(5));
    const pong = await ws.waitFor((m) => isJson("pong")(m) && JSON.parse(m.data).seq === 101);
    assert.ok(pong);
    ws.sock.destroy();
  });

  it("parses two frames arriving in one chunk", async () => {
    const ws = await openWs(port);
    const f1 = clientFrame(JSON.stringify({ type: "ping", seq: 201 }));
    const f2 = clientFrame(JSON.stringify({ type: "ping", seq: 202 }));
    ws.sock.write(Buffer.concat([f1, f2]));
    await ws.waitFor((m) => isJson("pong")(m) && JSON.parse(m.data).seq === 201);
    await ws.waitFor((m) => isJson("pong")(m) && JSON.parse(m.data).seq === 202);
    ws.sock.destroy();
  });

  it("closes 1009 on an oversized claimed frame length (no buffering)", async () => {
    const ws = await openWs(port);
    // 8-byte length claiming 512MB — parser must reject on the header alone
    const header = Buffer.alloc(14);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(512 * 1024 * 1024), 2);
    ws.sock.write(header); // includes 4 zero mask bytes at the end
    const close = await ws.waitFor((m) => m.type === "close");
    assert.equal(close.code, 1009);
    await ws.waitClosed();
  });

  it("closes 1002 on an unmasked client frame", async () => {
    const ws = await openWs(port);
    ws.sock.write(clientFrame(JSON.stringify({ type: "ping" }), { masked: false }));
    const close = await ws.waitFor((m) => m.type === "close");
    assert.equal(close.code, 1002);
    await ws.waitClosed();
  });

  it("echoes ping payload as pong (WS control frames)", async () => {
    const ws = await openWs(port);
    ws.sock.write(clientFrame(Buffer.from("liveness-probe"), { opcode: 0x9 }));
    const pong = await ws.waitFor((m) => m.type === "pong");
    assert.equal(pong.data.toString("utf8"), "liveness-probe");
    ws.sock.destroy();
  });

  it("reassembles a fragmented text message", async () => {
    const ws = await openWs(port);
    const whole = JSON.stringify({ type: "ping", seq: 301 });
    const a = whole.slice(0, 8);
    const b = whole.slice(8);
    ws.sock.write(clientFrame(a, { opcode: 0x1, fin: false }));
    ws.sock.write(clientFrame(b, { opcode: 0x0, fin: true }));
    const pong = await ws.waitFor((m) => isJson("pong")(m) && JSON.parse(m.data).seq === 301);
    assert.ok(pong);
    ws.sock.destroy();
  });

  it("echoes the peer's close code in the close handshake", async () => {
    const ws = await openWs(port);
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(4001, 0);
    ws.sock.write(clientFrame(payload, { opcode: 0x8 }));
    const close = await ws.waitFor((m) => m.type === "close");
    assert.equal(close.code, 4001);
    await ws.waitClosed();
  });

  it("closes 1002 on a continuation frame with no open fragment", async () => {
    const ws = await openWs(port);
    ws.sock.write(clientFrame("orphan", { opcode: 0x0, fin: true }));
    const close = await ws.waitFor((m) => m.type === "close");
    assert.equal(close.code, 1002);
    await ws.waitClosed();
  });

  it("closes 1007 on invalid UTF-8 in a text message", async () => {
    const ws = await openWs(port);
    ws.sock.write(clientFrame(Buffer.from([0xff, 0xfe, 0xfd]), { opcode: 0x1 }));
    const close = await ws.waitFor((m) => m.type === "close");
    assert.equal(close.code, 1007);
    await ws.waitClosed();
  });

  it("drops garbage bytes without crashing; server still accepts new connections", async () => {
    const ws = await openWs(port);
    // Deterministic garbage: nonzero RSV bits in the first byte guarantee a
    // protocol error (random bytes could, rarely, decode as valid frames).
    const garbage = Buffer.concat([Buffer.from([0xf1]), crypto.randomBytes(511)]);
    ws.sock.write(garbage);
    await ws.waitClosed();
    // gateway must still be alive and serving
    const ws2 = await openWs(port);
    ws2.sock.write(clientFrame(JSON.stringify({ type: "ping", seq: 999 })));
    const pong = await ws2.waitFor((m) => isJson("pong")(m) && JSON.parse(m.data).seq === 999);
    assert.ok(pong);
    ws2.sock.destroy();
  });
});
