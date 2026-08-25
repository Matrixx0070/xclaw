import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import net from "node:net";
import { attachWebSocketHub } from "../src/gateway/ws-hub.mjs";
import { attachVoiceWebSocket } from "../src/gateway/voice-ws.mjs";
import { createGatewayAuth } from "../src/gateway/auth.mjs";

/** Raw WS upgrade handshake; resolves with the HTTP status line + headers. */
function wsHandshake(port, { pathQuery = "/ws/events", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString("base64");
    const sock = net.connect(port, "127.0.0.1", () => {
      const lines = [
        `GET ${pathQuery} HTTP/1.1`,
        "Host: 127.0.0.1",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
        "\r\n",
      ];
      sock.write(lines.join("\r\n"));
    });
    let buf = "";
    sock.on("data", (c) => {
      buf += c.toString();
      if (buf.includes("\r\n\r\n")) {
        const statusLine = buf.split("\r\n")[0];
        sock.destroy();
        resolve({ statusLine, raw: buf });
      }
    });
    sock.on("error", reject);
    setTimeout(() => {
      sock.destroy();
      reject(new Error("handshake timeout"));
    }, 3000);
  });
}

/**
 * Both upgrade endpoints, wired the way the gateway wires them: ONE decision
 * function. /ws/voice used to be handed the auth object instead and asked
 * isProtectedPath("/ws/voice") — false in every mode, so its gate never ran and
 * the socket that reaches runAgent answered unauthenticated clients from 3.131.0
 * to 3.191.0. Every case below therefore runs against both paths.
 */
function startServer(cfg) {
  const server = http.createServer((_req, res) => res.end("ok"));
  const auth = createGatewayAuth(cfg);
  const authorize = (req) => auth.authorizeWebSocket(req);
  attachWebSocketHub(server, { authorize });
  attachVoiceWebSocket(server, { cfg, authorize });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

describe("WebSocket upgrade auth", () => {
  describe("no token configured (lab default) — open", () => {
    let ctx;
    before(async () => (ctx = await startServer({})));
    after(() => ctx.server.close());

    it("accepts the upgrade without credentials", async () => {
      const r = await wsHandshake(ctx.port);
      assert.match(r.statusLine, /101 Switching Protocols/);
    });

    it("accepts a voice upgrade without credentials", async () => {
      const r = await wsHandshake(ctx.port, { pathQuery: "/ws/voice" });
      assert.match(r.statusLine, /101 Switching Protocols/);
    });
  });

  describe("token configured — enforced", () => {
    let ctx;
    const TOKEN = "s3cr3t-token";
    before(async () => (ctx = await startServer({ gateway: { token: TOKEN } })));
    after(() => ctx.server.close());

    it("rejects an upgrade with no token (401)", async () => {
      const r = await wsHandshake(ctx.port);
      assert.match(r.statusLine, /401 Unauthorized/);
    });

    it("rejects an upgrade with the wrong token (401)", async () => {
      const r = await wsHandshake(ctx.port, { pathQuery: "/ws/events?token=nope" });
      assert.match(r.statusLine, /401/);
    });

    it("accepts a valid token via query param", async () => {
      const r = await wsHandshake(ctx.port, { pathQuery: `/ws/events?token=${TOKEN}` });
      assert.match(r.statusLine, /101 Switching Protocols/);
    });

    it("accepts a valid token via x-xclaw-token header", async () => {
      const r = await wsHandshake(ctx.port, { headers: { "x-xclaw-token": TOKEN } });
      assert.match(r.statusLine, /101/);
    });

    it("accepts + echoes a token subprotocol (browser path)", async () => {
      const r = await wsHandshake(ctx.port, {
        headers: { "Sec-WebSocket-Protocol": `xclaw.token.${TOKEN}` },
      });
      assert.match(r.statusLine, /101/);
      assert.match(r.raw, new RegExp(`Sec-WebSocket-Protocol: xclaw\\.token\\.${TOKEN}`));
    });

    it("rejects a voice upgrade with no token (401)", async () => {
      // The socket that reaches runAgent. It must never be more open than the
      // read-only event stream above.
      const r = await wsHandshake(ctx.port, { pathQuery: "/ws/voice" });
      assert.match(r.statusLine, /401 Unauthorized/);
    });

    it("rejects a voice upgrade with the wrong token (401)", async () => {
      const r = await wsHandshake(ctx.port, { pathQuery: "/ws/voice?token=nope" });
      assert.match(r.statusLine, /401/);
    });

    it("accepts a valid token on the voice path", async () => {
      const r = await wsHandshake(ctx.port, { pathQuery: `/ws/voice?token=${TOKEN}` });
      assert.match(r.statusLine, /101 Switching Protocols/);
    });

    it("accepts + echoes a token subprotocol on the voice path", async () => {
      const r = await wsHandshake(ctx.port, {
        pathQuery: "/ws/voice",
        headers: { "Sec-WebSocket-Protocol": `xclaw.token.${TOKEN}` },
      });
      assert.match(r.statusLine, /101/);
      assert.match(r.raw, new RegExp(`Sec-WebSocket-Protocol: xclaw\\.token\\.${TOKEN}`));
    });
  });

  describe("requireAuth with no token — fail closed", () => {
    let ctx;
    before(async () => (ctx = await startServer({ gateway: { requireAuth: true } })));
    after(() => ctx.server.close());

    it("rejects every upgrade (401)", async () => {
      const r = await wsHandshake(ctx.port, { pathQuery: "/ws/events?token=anything" });
      assert.match(r.statusLine, /401/);
    });

    it("rejects every voice upgrade (401)", async () => {
      const r = await wsHandshake(ctx.port, { pathQuery: "/ws/voice?token=anything" });
      assert.match(r.statusLine, /401/);
    });
  });
});
