
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
    // Ephemeral port, read back after bind. This used to pick a random port
    // in 18000-18999 — a range that contains 18790, the live gateway — and on
    // collision the fetches below reached the gateway's open /health instead
    // of the proxy: 200 without a token, wrong body, a failure that looked
    // like the proxy's and was the fixture's.
    proxy = startComputerAuthProxy({
      cfg: { computer: { authToken: "proxy-secret" } },
      upstream: `http://127.0.0.1:${upPort}`,
      listenPort: 0,
    });
    await new Promise((resolve, reject) => {
      proxy.once("listening", resolve);
      proxy.once("error", reject);
    });
    proxyPort = proxy.address().port;
    assert.notEqual(proxyPort, 4244, "listenPort: 0 was rewritten to the default — an ephemeral bind is unrequestable");
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
