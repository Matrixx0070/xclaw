import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHttpServer } from "../src/gateway/tls.mjs";

describe("tls wrap computer proxy", () => {
  it("proxies /computer/proxy/* before the inner listener", async () => {
    const upstream = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ up: true, path: req.url }));
    });
    await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
    const upPort = upstream.address().port;
    const cfg = {
      computer: { host: "127.0.0.1", port: upPort },
      gateway: { proxyComputer: true },
    };
    let innerHit = false;
    const { server } = createHttpServer((req, res) => {
      innerHit = true;
      res.writeHead(418);
      res.end("inner");
    }, cfg);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const gp = server.address().port;
    const body = await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${gp}/computer/proxy/health`, (res) => {
          let d = "";
          res.on("data", (c) => (d += c));
          res.on("end", () => resolve({ status: res.statusCode, d, innerHit }));
        })
        .on("error", reject);
    });
    server.close();
    upstream.close();
    assert.equal(body.status, 200);
    assert.equal(innerHit, false);
  });
});
