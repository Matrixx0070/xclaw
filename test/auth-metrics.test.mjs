import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createGatewayAuth } from "../src/gateway/auth.mjs";

describe("gateway auth 1.0", () => {
  it("open metrics by default", () => {
    const a = createGatewayAuth({});
    assert.equal(a.isProtectedPath("/metrics"), false);
    assert.equal(a.isProtectedPath("/health"), false);
  });
  it("protects metrics when token + protectMetrics", () => {
    const a = createGatewayAuth({
      gateway: { token: "secret", protectMetrics: true },
    });
    assert.equal(a.isProtectedPath("/metrics"), true);
    assert.equal(a.isProtectedPath("/ready"), false);
    const ok = a.check({
      url: "/metrics",
      headers: { authorization: "Bearer secret" },
    });
    assert.equal(ok.ok, true);
    const bad = a.check({ url: "/metrics", headers: {} });
    assert.equal(bad.ok, false);
  });
});
