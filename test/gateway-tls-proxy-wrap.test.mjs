/**
 * What createHttpServer is allowed to answer ahead of the router.
 *
 * It used to proxy /computer/proxy/* and /xclaw/computer/* here, before the
 * listener — and the gateway's 401 gate lives inside that listener, so those
 * prefixes were unauthenticated on every gateway with the (default-on) proxy
 * enabled, while the plane behind them answers POST /tool with any tool, bash
 * included. This file pinned that ordering ("proxies before the inner
 * listener"); it now pins its inverse, because a wrapper that proxies is a
 * wrapper that bypasses auth. The proxy itself is unchanged and still
 * reachable — it is dispatched inside the listener, below the gate
 * (src/gateway/index.mjs), and covered end-to-end over a socket by
 * test/gateway-auth-enforcement.test.mjs.
 *
 * /stop is the one exception and stays: handleStopAll runs authorizeStop
 * itself, and there is no /stop route in the router to fall through to.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHttpServer } from "../src/gateway/tls.mjs";

/** GET/POST a path on a listening server; resolves { status, body }. */
function fetchPath(port, p, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path: p, method },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ status: res.statusCode, body: d }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

describe("createHttpServer request wrapping", () => {
  it("does not proxy computer paths ahead of the listener", async () => {
    // An upstream that must never be contacted: reaching it would mean the
    // wrapper forwarded a request the gate never saw.
    const upstreamHits = [];
    const upstream = http.createServer((req, res) => {
      upstreamHits.push(req.url);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ up: true }));
    });
    await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
    const cfg = {
      computer: { host: "127.0.0.1", port: upstream.address().port },
      gateway: { proxyComputer: true },
    };

    let innerHit = false;
    const { server } = createHttpServer((req, res) => {
      innerHit = true;
      res.writeHead(418);
      res.end("inner");
    }, cfg);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));

    const r = await fetchPath(server.address().port, "/computer/proxy/health");

    server.close();
    upstream.close();
    assert.equal(innerHit, true, "the listener owns computer paths — that is where the auth gate is");
    assert.equal(r.status, 418);
    assert.deepEqual(upstreamHits, [], "the wrapper must not forward to the computer plane");
  });

  it("still answers the kill switch ahead of the listener", async () => {
    // The stop intercept has to stay in front of the router: it needs the
    // unparsed body, and the router has no /stop route. It carries its own
    // auth, so an unauthenticated POST is refused rather than passed through.
    const cfg = { gateway: { token: "s".repeat(64) } };
    let innerHit = false;
    const { server } = createHttpServer((req, res) => {
      innerHit = true;
      res.writeHead(418);
      res.end("inner");
    }, cfg);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));

    const r = await fetchPath(server.address().port, "/stop", "POST");

    server.close();
    assert.equal(r.status, 401, `the kill switch must authenticate (got ${r.status}: ${r.body})`);
    assert.match(r.body, /STOP_UNAUTHORIZED/);
    assert.equal(innerHit, false, "the stop intercept still runs ahead of the router");
  });
});
