import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  matchComputerProxyPath,
  isComputerProxyEnabled,
  proxyComputerRequest,
  COMPUTER_PROXY_PREFIXES,
} from "../src/gateway/computer-proxy.mjs";

describe("computer proxy path match", () => {
  it("matches /computer/proxy/* and /xclaw/computer/*", () => {
    assert.equal(matchComputerProxyPath("/computer/proxy/health").matched, true);
    assert.equal(matchComputerProxyPath("/computer/proxy/health").upstreamPath, "/health");
    assert.equal(matchComputerProxyPath("/xclaw/computer/v1/sessions").upstreamPath, "/v1/sessions");
    assert.equal(matchComputerProxyPath("/computer/proxy").upstreamPath, "/health");
    assert.equal(matchComputerProxyPath("/agent/run").matched, false);
  });

  it("enabled by default", () => {
    assert.equal(isComputerProxyEnabled({}), true);
    assert.equal(isComputerProxyEnabled({ gateway: { proxyComputer: false } }), false);
  });

  it("prefixes documented", () => {
    assert.ok(COMPUTER_PROXY_PREFIXES.some((p) => p.includes("computer/proxy")));
  });
});

describe("computer proxy integration", () => {
  it("forwards GET to mock upstream", async () => {
    const upstream = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    });
    await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
    const port = upstream.address().port;
    const cfg = { computer: { host: "127.0.0.1", port }, gateway: { proxyComputer: true } };

    const result = await new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, "http://local");
        const handled = await proxyComputerRequest(req, res, cfg, url);
        if (!handled) {
          res.writeHead(404);
          res.end("no");
        }
      });
      server.listen(0, "127.0.0.1", () => {
        const gp = server.address().port;
        http
          .get(`http://127.0.0.1:${gp}/computer/proxy/health`, (res) => {
            let d = "";
            res.on("data", (c) => (d += c));
            res.on("end", () => {
              server.close();
              upstream.close();
              try {
                resolve({ status: res.statusCode, body: JSON.parse(d) });
              } catch (e) {
                reject(e);
              }
            });
          })
          .on("error", reject);
      });
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.path, "/health");
  });
});
