
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startComputerAuthProxy } from "../src/computer/auth-proxy.mjs";

describe("auth proxy", () => {
  let upstream;
  let proxy;
  let upPort;
  let proxyPort;

  before(async () => {
    upstream = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "healthy", via: "upstream" }));
    });
    await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
    upPort = upstream.address().port;
    proxyPort = 0; // will set after listen — startComputerAuthProxy uses fixed port
    // use high random-ish port
    proxyPort = 18000 + Math.floor(Math.random() * 1000);
    proxy = startComputerAuthProxy({
      cfg: { computer: { authToken: "proxy-secret" } },
      upstream: `http://127.0.0.1:${upPort}`,
      listenPort: proxyPort,
    });
    await new Promise((r) => setTimeout(r, 50));
  });

  after(async () => {
    await new Promise((r) => proxy.close(r));
    await new Promise((r) => upstream.close(r));
  });

  it("401 without token", async () => {
    const r = await fetch(`http://127.0.0.1:${proxyPort}/health`);
    assert.equal(r.status, 401);
  });

  it("200 with bearer", async () => {
    const r = await fetch(`http://127.0.0.1:${proxyPort}/health`, {
      headers: { Authorization: "Bearer proxy-secret" },
    });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.via, "upstream");
  });
});
