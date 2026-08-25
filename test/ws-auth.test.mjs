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

    // The subprotocol carrier is the ONLY one a browser can set on a WS
    // handshake — it cannot send Authorization or x-xclaw-token, and ?token=
    // leaks the token into access logs — so `xclaw.token.<t>` is the Control
    // UI's real auth path. Every case above presents the CORRECT token through
    // it; none proved a WRONG token is rejected. Mutating the extraction in
    // authorizeWebSocket (`sub = p.slice("xclaw.token.".length)` -> `sub =
    // token`, i.e. accept ANY xclaw.token.* value) left the full suite green
    // (3518/0): the shared compare is pinned only by the ?token=nope cases on
    // the query carrier, and no test ever sent a wrong non-empty token through
    // the subprotocol. These pin the subprotocol carrier's rejection on BOTH
    // upgrade paths, with prefix and superstring values so a startsWith-style
    // weakening (got a prefix of token, or token a prefix of got) is caught too.
    const wrongSubproto = [
      "nope",
      "s3cr3t-toke", // one char short — got is a prefix of the real token
      "s3cr3t-token-extra", // superstring — the real token is a prefix of got
    ];
    for (const w of wrongSubproto) {
      it(`rejects an events upgrade with a wrong subprotocol token ${JSON.stringify(w)} (401)`, async () => {
        const r = await wsHandshake(ctx.port, {
          headers: { "Sec-WebSocket-Protocol": `xclaw.token.${w}` },
        });
        assert.match(r.statusLine, /401/, `wrong subprotocol token ${JSON.stringify(w)} must be rejected on /ws/events`);
      });

      it(`rejects a voice upgrade with a wrong subprotocol token ${JSON.stringify(w)} (401)`, async () => {
        const r = await wsHandshake(ctx.port, {
          pathQuery: "/ws/voice",
          headers: { "Sec-WebSocket-Protocol": `xclaw.token.${w}` },
        });
        assert.match(r.statusLine, /401/, `wrong subprotocol token ${JSON.stringify(w)} must be rejected on /ws/voice`);
      });
    }

    // Header carriers (Authorization: Bearer / x-xclaw-token / x-api-key).
    // authorizeWebSocket extracts each of these separately before the shared
    // tokenEqual compare (`got = bearer || x || q || sub`). The subprotocol
    // cases above pin that shared compare's exactness; these pin each HEADER
    // carrier's own extraction. Before this, NO test ever sent a WRONG token
    // through any header carrier — the only wrong-token rejects went via
    // ?token= (query) and xclaw.token.* (subprotocol). Mutating just the
    // Bearer extraction to accept any value (`const bearer = hdr.startsWith(
    // "Bearer ") ? token : ""`) left the FULL suite green (3528/0): an
    // `Authorization: Bearer <wrong>` reached the runAgent socket on /ws/voice
    // unauthenticated. The rejects below run on BOTH upgrade paths so neither
    // can be more open than the other (voice-ws and the event hub share ONE
    // authorize fn, but the wiring is asserted, not assumed).
    const headerReject = [
      { name: "Authorization: Bearer", bad: { authorization: "Bearer nope" } },
      { name: "x-xclaw-token", bad: { "x-xclaw-token": "nope" } },
      { name: "x-api-key", bad: { "x-api-key": "nope" } },
    ];
    for (const c of headerReject) {
      it(`rejects a wrong token via ${c.name} on /ws/events (401)`, async () => {
        const r = await wsHandshake(ctx.port, { headers: c.bad });
        assert.match(r.statusLine, /401/, `wrong ${c.name} must be rejected on /ws/events`);
      });
      it(`rejects a wrong token via ${c.name} on /ws/voice (401)`, async () => {
        const r = await wsHandshake(ctx.port, { pathQuery: "/ws/voice", headers: c.bad });
        assert.match(r.statusLine, /401/, `wrong ${c.name} must be rejected on /ws/voice`);
      });
    }

    // Positive side of the two header carriers that had NO accept test at all
    // (query, x-xclaw-token, and subprotocol accepts are covered above). These
    // pin the Bearer + x-api-key extractions themselves: a wrong slice offset
    // or a dropped header key makes `got` empty and turns these RED.
    const headerAccept = [
      { name: "Authorization: Bearer", good: { authorization: `Bearer ${TOKEN}` } },
      { name: "x-api-key", good: { "x-api-key": TOKEN } },
    ];
    for (const c of headerAccept) {
      it(`accepts a valid token via ${c.name}`, async () => {
        const r = await wsHandshake(ctx.port, { headers: c.good });
        assert.match(r.statusLine, /101/, `valid token via ${c.name} must be accepted`);
      });
    }
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
