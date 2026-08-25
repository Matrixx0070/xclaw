/**
 * Gateway proxy HTTP smoke: routes catalog + live GET through createHttpServer.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHttpServer } from "../src/gateway/tls.mjs";
import { listRoutes } from "../src/gateway/routes-map.mjs";
import {
  matchComputerProxyPath,
  isComputerProxyEnabled,
  proxyComputerRequest,
} from "../src/gateway/computer-proxy.mjs";

describe("gateway proxy routes catalog", () => {
  it("lists /computer/proxy/*", () => {
    const routes = listRoutes();
    assert.ok(
      routes.some((r) => String(r.path).includes("/computer/proxy")),
      JSON.stringify(routes.filter((r) => /computer/i.test(r.path)))
    );
  });

  it("matchComputerProxyPath strips prefix", () => {
    assert.deepEqual(matchComputerProxyPath("/computer/proxy/health"), {
      matched: true,
      upstreamPath: "/health",
    });
    assert.deepEqual(matchComputerProxyPath("/xclaw/computer/v1/sessions"), {
      matched: true,
      upstreamPath: "/v1/sessions",
    });
    assert.equal(matchComputerProxyPath("/agent/run").matched, false);
  });

  it("proxy enabled by default", () => {
    assert.equal(isComputerProxyEnabled({}), true);
    assert.equal(isComputerProxyEnabled({ gateway: { proxyComputer: false } }), false);
  });
});

describe("gateway proxy HTTP smoke", () => {
  it("GET /computer/proxy/health through gateway wrap", async () => {
    const upstream = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, upstream: req.url }));
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
      res.end("not-proxy");
    }, cfg);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const gp = server.address().port;

    async function get(path) {
      return new Promise((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${gp}${path}`, (res) => {
            let d = "";
            res.on("data", (c) => (d += c));
            res.on("end", () => resolve({ status: res.statusCode, body: d }));
          })
          .on("error", reject);
      });
    }

    const a = await get("/computer/proxy/health");
    assert.equal(a.status, 200);
    assert.match(a.body, /"ok":\s*true/);

    const b = await get("/xclaw/computer/health");
    assert.equal(b.status, 200);

    const c = await get("/not-a-proxy");
    assert.equal(c.status, 404);

    server.close();
    upstream.close();
  });
});
