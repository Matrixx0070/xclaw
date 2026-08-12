import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeTextFrame, decodeFrames, broadcast, wsClientCount } from "../src/gateway/ws-hub.mjs";

describe("ws-hub frames", () => {
  it("round-trips text frame without mask", () => {
    const payload = JSON.stringify({ hello: "world" });
    const frame = encodeTextFrame(payload);
    assert.equal(frame[0] & 0x0f, 0x1);
    // server frames are unmasked — decode still works
    const { messages, rest } = decodeFrames(frame);
    assert.equal(rest.length, 0);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, "text");
    assert.equal(messages[0].data, payload);
  });

  it("decodes masked client frame", () => {
    const text = "ping-data";
    const payload = Buffer.from(text, "utf8");
    const mask = Buffer.from([1, 2, 3, 4]);
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
    const header = Buffer.from([0x81, 0x80 | payload.length]);
    const frame = Buffer.concat([header, mask, masked]);
    const { messages } = decodeFrames(frame);
    assert.equal(messages[0].data, text);
  });

  it("broadcast with no clients is safe", () => {
    assert.equal(wsClientCount(), 0);
    assert.equal(broadcast("admission", { ok: true }), 0);
  });
});

describe("ws-hub heartbeat", () => {
  it("heartbeatStats starts empty", async () => {
    const http = await import("node:http");
    const { attachWebSocketHub } = await import("../src/gateway/ws-hub.mjs");
    const server = http.createServer();
    const hub = attachWebSocketHub(server, { heartbeatMs: 60_000, missThreshold: 2 });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const st = hub.heartbeatStats();
    assert.equal(st.clients, 0);
    assert.equal(st.pingsSent, 0);
    hub.closeAll();
    server.close();
  });

  it("client pong keeps connection through ticks", async () => {
    const http = await import("node:http");
    const { attachWebSocketHub } = await import("../src/gateway/ws-hub.mjs");
    const server = http.createServer();
    const hub = attachWebSocketHub(server, { heartbeatMs: 80, missThreshold: 2 });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/events`);
    let pings = 0;
    await new Promise((resolve, reject) => {
      ws.onopen = () => {};
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.type === "ping") {
          pings += 1;
          ws.send(JSON.stringify({ type: "pong", t: Date.now(), seq: m.seq }));
          if (pings >= 2) resolve();
        }
      };
      ws.onerror = reject;
      setTimeout(() => reject(new Error("no pings")), 2000);
    });
    assert.ok(pings >= 2);
    assert.equal(hub.clientCount(), 1);
    ws.close();
    hub.closeAll();
    server.close();
  });
});
