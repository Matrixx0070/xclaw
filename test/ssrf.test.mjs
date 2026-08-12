import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  isPrivateIp,
  assertUrlAllowed,
  safeFetch,
  requestPinned,
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

  it("assertUrlAllowed returns a pinIp for hostnames + literal IPs", async () => {
    const lit = await assertUrlAllowed("http://8.8.8.8/", {});
    assert.equal(lit.ok, true);
    assert.equal(lit.pinIp, "8.8.8.8");
    // allowHosts / off bypass → no pin, caller falls back to normal resolution
    const bypass = await assertUrlAllowed("http://8.8.8.8/", {
      security: { ssrf: { mode: "off" } },
    });
    assert.equal(bypass.pinIp, null);
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

describe("requestPinned — connection is pinned to the validated IP", () => {
  let server;
  let port;

  before(async () => {
    server = http.createServer((req, res) => {
      // Echo back the Host header so we can confirm the real name is preserved
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`host=${req.headers.host}`);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });

  after(() => server?.close());

  it("connects to the pinned IP, ignoring what the hostname resolves to", async () => {
    // example.com resolves to a real PUBLIC IP in DNS. Pinning to 127.0.0.1
    // must send the socket to our LOCAL server instead — the only way this
    // request can hit our loopback listener. Proves DNS is bypassed at connect.
    const res = await requestPinned(`http://example.com:${port}/`, {
      ip: "127.0.0.1",
    });
    assert.equal(res.status, 200);
    // Host header keeps the real hostname (Host/SNI/cert integrity preserved)
    assert.match(await res.text(), /host=example\.com:/);
  });

  it("passes headers and decodes the body", async () => {
    const res = await requestPinned(`http://example.com:${port}/`, {
      ip: "127.0.0.1",
    });
    assert.equal(res.headers.get("content-type"), "text/plain");
    assert.equal(typeof (await res.text()), "string");
  });
});

describe("SSRF metadata floor", () => {
  it("isMetadataIp classifies metadata endpoints across encodings", async () => {
    const { isMetadataIp } = await import("../src/security/ssrf.mjs");
    for (const ip of [
      "169.254.169.254",
      "169.254.0.1", // whole link-local range
      "100.100.100.200", // Alibaba
      "fd00:ec2::254", // AWS IPv6
      "::ffff:169.254.169.254", // mapped
    ]) {
      assert.equal(isMetadataIp(ip), true, ip);
    }
    for (const ip of ["127.0.0.1", "10.0.0.1", "8.8.8.8", "2606:4700::1111"]) {
      assert.equal(isMetadataIp(ip), false, ip);
    }
  });

  it("blocks metadata literal even with allowPrivate", async () => {
    const cfg = { security: { ssrf: { allowPrivate: true } } };
    const r = await assertUrlAllowed("http://169.254.169.254/latest/", cfg, {
      metadataFloor: true,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /metadata/i);
  });

  it("blocks metadata hostname even with mode=off", async () => {
    const cfg = { security: { ssrf: { mode: "off" } } };
    const r = await assertUrlAllowed("http://metadata.google.internal/x", cfg, {
      metadataFloor: true,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /metadata/i);
  });

  it("allowPrivate + floor still permits loopback (floor is metadata-only)", async () => {
    const cfg = { security: { ssrf: { allowPrivate: true } } };
    const r = await assertUrlAllowed("http://127.0.0.1:9/", cfg, { metadataFloor: true });
    assert.equal(r.ok, true);
    assert.equal(r.pinIp, null); // bypassed lookups don't pin
  });

  it("default policy without floor is unchanged (regression guard)", async () => {
    const r = await assertUrlAllowed("http://169.254.169.254/");
    assert.equal(r.ok, false); // still blocked by the private-range check
    const ok = await assertUrlAllowed("http://127.0.0.1/", {
      security: { ssrf: { allowPrivate: true } },
    });
    assert.equal(ok.ok, true);
  });
});
