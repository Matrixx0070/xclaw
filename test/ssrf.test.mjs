import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  isPrivateIp,
  assertUrlAllowed,
  safeFetch,
  getSsrfPolicy,
} from "../src/security/ssrf.mjs";

describe("SSRF IP classifier", () => {
  it("flags loopback, private, link-local, metadata, ULA", () => {
    for (const ip of [
      "127.0.0.1",
      "127.5.5.5",
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "0.0.0.0",
      "::1",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "::ffff:127.0.0.1", // v4-mapped loopback
    ]) {
      assert.equal(isPrivateIp(ip), true, `${ip} should be private`);
    }
  });

  it("allows real public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) {
      assert.equal(isPrivateIp(ip), false, `${ip} should be public`);
    }
  });

  it("treats non-IP / garbage as unsafe", () => {
    assert.equal(isPrivateIp("not-an-ip"), true);
    assert.equal(isPrivateIp("999.999.999.999"), true);
  });
});

describe("assertUrlAllowed", () => {
  it("blocks non-http schemes", async () => {
    const r = await assertUrlAllowed("file:///etc/passwd", {});
    assert.equal(r.ok, false);
    assert.match(r.error, /scheme/);
  });

  it("blocks literal private IP URLs", async () => {
    const r = await assertUrlAllowed("http://169.254.169.254/latest/meta-data/", {});
    assert.equal(r.ok, false);
    assert.match(r.error, /private|loopback/);
  });

  it("blocks decimal-encoded loopback (getaddrinfo canonicalizes)", async () => {
    const r = await assertUrlAllowed("http://2130706433/", {}); // 127.0.0.1
    assert.equal(r.ok, false);
  });

  it("allowPrivate bypasses for lab dev", async () => {
    const r = await assertUrlAllowed("http://127.0.0.1:9/", {
      security: { ssrf: { allowPrivate: true } },
    });
    assert.equal(r.ok, true);
  });

  it("allowHosts exempts a named host", async () => {
    const r = await assertUrlAllowed("http://localhost:9/", {
      security: { ssrf: { allowHosts: ["localhost"] } },
    });
    assert.equal(r.ok, true);
  });

  it("mode=off disables the guard", async () => {
    assert.equal(getSsrfPolicy({ security: { ssrf: { mode: "off" } } }).mode, "off");
    const r = await assertUrlAllowed("http://127.0.0.1/", { security: { ssrf: { mode: "off" } } });
    assert.equal(r.ok, true);
  });
});

describe("safeFetch redirect re-validation", () => {
  let server;
  let base;

  before(async () => {
    // Public-looking loopback server (allowed via allowHosts) that 302s to a
    // blocked metadata address — safeFetch must catch the hop, not the origin.
    server = http.createServer((req, res) => {
      if (req.url === "/redirect-to-metadata") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
        return res.end();
      }
      if (req.url === "/ok") {
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("hello");
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server?.close());

  it("blocks a redirect hop into metadata even from an allowed origin", async () => {
    const cfg = { security: { ssrf: { allowHosts: ["127.0.0.1"] } } };
    await assert.rejects(
      () => safeFetch(`${base}/redirect-to-metadata`, {}, cfg),
      /SSRF blocked/
    );
  });

  it("passes a normal 200 from an allowed host", async () => {
    const cfg = { security: { ssrf: { allowHosts: ["127.0.0.1"] } } };
    const res = await safeFetch(`${base}/ok`, {}, cfg);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "hello");
  });
});
