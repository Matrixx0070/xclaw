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
});
