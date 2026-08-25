/**
 * Computer proxy preserves SSE text/event-stream + flush (no full buffer).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHttpServer } from "../src/gateway/tls.mjs";
import {
  matchComputerProxyPath,
  isComputerProxyEnabled,
  proxyComputerRequest,
} from "../src/gateway/computer-proxy.mjs";

describe("computer proxy SSE", () => {
  it("forwards event-stream chunks without waiting for end", async () => {
    const upstream = http.createServer((req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("event: heartbeat\ndata: 1\n\n");
      setTimeout(() => {
        res.write("event: heartbeat\ndata: 2\n\n");
        res.end();
      }, 30);
    });
    await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
    const upPort = upstream.address().port;

    const cfg = {
      computer: { host: "127.0.0.1", port: upPort },
      gateway: { proxyComputer: true },
    };
    // Same dispatch order as the real gateway: the listener owns the proxy,
    // which is what puts it below the 401 gate (see tls.mjs).
    const { server } = createHttpServer(async (req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (isComputerProxyEnabled(cfg) && (await proxyComputerRequest(req, res, cfg, url))) return;
      res.writeHead(404);
      res.end("no");
    }, cfg);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const gp = server.address().port;

    const chunks = [];
    await new Promise((resolve, reject) => {
      const req = http.get(
        {
          hostname: "127.0.0.1",
          port: gp,
          path: "/computer/proxy/events",
          headers: { Accept: "text/event-stream" },
        },
        (res) => {
          assert.equal(res.statusCode, 200);
          assert.match(String(res.headers["content-type"] || ""), /text\/event-stream/i);
          res.on("data", (c) => chunks.push(c.toString()));
          res.on("end", resolve);
        }
      );
      req.on("error", reject);
      setTimeout(() => reject(new Error("SSE hung")), 3000);
    });

    const body = chunks.join("");
    assert.match(body, /heartbeat/);
    assert.match(body, /data: 1/);
    assert.match(body, /data: 2/);

    server.close();
    upstream.close();
  });

  it("match path for events", () => {
    const m = matchComputerProxyPath("/computer/proxy/events");
    assert.equal(m.matched, true);
    assert.equal(m.upstreamPath, "/events");
  });
});
