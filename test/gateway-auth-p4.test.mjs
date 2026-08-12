import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createGatewayAuth } from "../src/gateway/auth.mjs";
import { loadTlsOptions } from "../src/gateway/tls.mjs";
import { resolveImagineMatrix } from "../src/media/imagine-models.mjs";

describe("P4 gateway", () => {
  it("requires token on /agent when set", () => {
    const a = createGatewayAuth({ gateway: { token: "t", authStrict: true } });
    assert.equal(a.check({ url: "/agent/run", headers: {} }).ok, false);
    assert.equal(
      a.check({ url: "/agent/run", headers: { authorization: "Bearer t" } }).ok,
      true
    );
  });

  it("keeps /health open", () => {
    const a = createGatewayAuth({ gateway: { token: "t" } });
    assert.equal(a.check({ url: "/health", headers: {} }).ok, true);
  });

  it("tls returns null without certs", () => {
    assert.equal(loadTlsOptions({}), null);
  });

  it("imagine matrix has models", () => {
    const m = resolveImagineMatrix({});
    assert.ok(m.models.length >= 1);
    assert.ok(m.endpoints.length >= 1);
  });
});
