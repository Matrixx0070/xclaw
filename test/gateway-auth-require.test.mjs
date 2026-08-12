import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createGatewayAuth } from "../src/gateway/auth.mjs";

describe("gateway requireAuth fail-closed", () => {
  it("prod without token denies protected API paths", () => {
    const auth = createGatewayAuth({ profile: "prod", gateway: {} });
    assert.equal(auth.requireAuth, true);
    const r = auth.check({ url: "/agent/run", headers: {} });
    assert.equal(r.ok, false);
    assert.equal(r.error, "auth_required_no_token_configured");
  });

  it("lab without token still open for API", () => {
    const auth = createGatewayAuth({ profile: "lab", gateway: {} });
    assert.equal(auth.requireAuth, false);
    const r = auth.check({ url: "/agent/run", headers: {} });
    assert.equal(r.ok, true);
    assert.equal(r.mode, "open");
  });

  it("prod with token accepts bearer", () => {
    const auth = createGatewayAuth({
      profile: "prod",
      gateway: { token: "secret-token-xyz" },
    });
    const bad = auth.check({ url: "/agent/run", headers: {} });
    assert.equal(bad.ok, false);
    const good = auth.check({
      url: "/agent/run",
      headers: { authorization: "Bearer secret-token-xyz" },
    });
    assert.equal(good.ok, true);
    assert.equal(good.mode, "token");
  });

  it("health stays open even in prod without token", () => {
    const auth = createGatewayAuth({ profile: "prod", gateway: {} });
    const r = auth.check({ url: "/health", headers: {} });
    assert.equal(r.ok, true);
  });
});
