import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { corsOriginFor } from "../src/gateway/cors.mjs";

describe("gateway CORS policy", () => {
  const req = (origin) => ({ headers: origin ? { origin } : {} });

  it("no Origin header → no CORS header (same-origin/curl)", () => {
    assert.equal(corsOriginFor(req(null), {}), null);
  });

  it("loopback origins reflected by default", () => {
    assert.equal(corsOriginFor(req("http://127.0.0.1:18790"), {}), "http://127.0.0.1:18790");
    assert.equal(corsOriginFor(req("http://localhost:3000"), {}), "http://localhost:3000");
  });

  it("non-loopback origins blocked by default (was wildcard)", () => {
    assert.equal(corsOriginFor(req("https://evil.example"), {}), null);
  });

  it("cfg.gateway.corsOrigin allows explicit origins or wildcard", () => {
    const cfg1 = { gateway: { corsOrigin: "https://app.example" } };
    assert.equal(corsOriginFor(req("https://app.example"), cfg1), "https://app.example");
    assert.equal(corsOriginFor(req("https://other.example"), cfg1), null);
    assert.equal(corsOriginFor(req("https://any.example"), { gateway: { corsOrigin: "*" } }), "*");
    const cfgList = { gateway: { corsOrigin: ["https://a.example", "https://b.example"] } };
    assert.equal(corsOriginFor(req("https://b.example"), cfgList), "https://b.example");
  });

  it("malformed origin → no header", () => {
    assert.equal(corsOriginFor(req("not a url"), {}), null);
  });

  // corsOriginFor decides which cross-origin pages may READ gateway responses;
  // on a tokenless lab gateway it is the only thing between a drive-by web page
  // and /sessions, /config, etc. Every allow-branch is an EXACT match — Set
  // membership for loopback, === / Array.includes for the operator allowlist.
  // The five tests above only ever present origins DISJOINT from an allowed
  // value, so a "simplification" to a substring/prefix test (Set.has →
  // hostname.includes, === → origin.startsWith) leaves them all green while
  // reflecting an attacker domain. Both weakenings were mutation-confirmed to
  // keep the suite at 5/5. The cases below present origins that EMBED an allowed
  // value and pin the exactness so either weakening turns this file red.

  it("a domain embedding a loopback host as a substring is NOT reflected", () => {
    // Attacker registers 127.0.0.1.evil.com / localhost.evil.com: the hostname
    // is the whole attacker label, not the loopback prefix, so Set.has rejects
    // it; a hostname.includes("127.0.0.1") weakening would wrongly reflect it.
    for (const o of [
      "http://127.0.0.1.evil.com",
      "http://localhost.evil.com",
      "http://127.0.0.1.evil.com:8080",
      "http://evil.localhost.com",
      "http://notlocalhost",
    ]) {
      assert.equal(corsOriginFor(req(o), {}), null, `${o} must not be reflected`);
    }
  });

  it("userinfo that looks like a loopback host is NOT reflected (real host wins)", () => {
    // new URL("http://127.0.0.1@evil.com").hostname === "evil.com"
    assert.equal(corsOriginFor(req("http://127.0.0.1@evil.com"), {}), null);
  });

  it("configured string origin matches EXACTLY — a suffix domain is NOT reflected", () => {
    const cfg = { gateway: { corsOrigin: "https://app.example" } };
    // Attacker registers app.example.evil.com; origin.startsWith(conf) passes it.
    assert.equal(corsOriginFor(req("https://app.example.evil.com"), cfg), null);
    // One char short — defends the other direction (endsWith / reversed prefix).
    assert.equal(corsOriginFor(req("https://app.exampl"), cfg), null);
    assert.equal(corsOriginFor(req("https://app.example"), cfg), "https://app.example");
  });

  it("configured list origin matches EXACTLY — a suffix domain is NOT reflected", () => {
    const cfg = { gateway: { corsOrigin: ["https://a.example", "https://b.example"] } };
    assert.equal(corsOriginFor(req("https://a.example.evil.com"), cfg), null);
    assert.equal(corsOriginFor(req("https://a.exampl"), cfg), null);
    assert.equal(corsOriginFor(req("https://a.example"), cfg), "https://a.example");
  });
});
