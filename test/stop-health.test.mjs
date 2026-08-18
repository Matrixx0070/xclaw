import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stopAuthReadiness } from "../src/gateway/stop-health.mjs";

describe("stop health readiness", () => {
  it("lab without token", () => {
    const r = stopAuthReadiness({});
    assert.equal(r.auth, "lab");
    assert.equal(r.ready, true);
  });

  it("token + hmac configured", () => {
    const r = stopAuthReadiness({
      gateway: { token: "s", stopHmacSecret: "h" },
    });
    assert.equal(r.auth, "token");
    assert.equal(r.hmac, "configured");
    assert.equal(r.ready, true);
  });

  it("prod missing token not ready", () => {
    const r = stopAuthReadiness({ profile: "prod" });
    assert.equal(r.auth, "missing");
    assert.equal(r.ready, false);
  });
});
