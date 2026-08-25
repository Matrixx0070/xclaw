/**
 * createHttpServer must receive cfg so computer proxy uses real host/port.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHttpServer } from "../src/gateway/tls.mjs";
import { isComputerProxyEnabled, proxyComputerRequest } from "../src/gateway/computer-proxy.mjs";

describe("createHttpServer cfg", () => {
  it("proxies to cfg.computer.port not default 4243", async () => {
    const upstream = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ port: "custom", path: req.url }));
    });
    await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
    const upPort = upstream.address().port;
    assert.notEqual(upPort, 4243);

    const cfg = {
      computer: { host: "127.0.0.1", port: upPort },
      gateway: { proxyComputer: true },
    };
    // Same dispatch order as the real gateway: the listener owns the proxy,
    // which is what puts it below the 401 gate (see tls.mjs).
    const { server } = createHttpServer(async (req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (isComputerProxyEnabled(cfg) && (await proxyComputerRequest(req, res, cfg, url))) return;
      res.writeHead(418);
      res.end("inner");
    }, cfg);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const gp = server.address().port;

    const result = await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${gp}/computer/proxy/health`, (res) => {
          let d = "";
          res.on("data", (c) => (d += c));
          res.on("end", () => resolve({ status: res.statusCode, body: d }));
        })
        .on("error", reject);
    });
    server.close();
    upstream.close();
    assert.equal(result.status, 200);
    assert.match(result.body, /custom/);
  });
});
