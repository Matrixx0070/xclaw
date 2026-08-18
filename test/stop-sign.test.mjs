import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildStopSignResult } from "../src/cli/stop-sign.mjs";
import { signStopBody } from "../src/gateway/stop-auth.mjs";

describe("stop --sign", () => {
  it("mints matching HMAC", () => {
    const cfg = {
      gateway: { token: "tok", stopHmacSecret: "sekrit", host: "127.0.0.1", port: 18790 },
    };
    const r = buildStopSignResult(cfg, {
      body: { type: "stop" },
      printCurl: true,
    });
    assert.equal(r.hasSecret, true);
    assert.equal(r.sig, signStopBody("sekrit", r.body));
    assert.equal(r.headers["X-XClaw-Stop-Sig"], r.sig);
    assert.ok(r.curl.includes("X-XClaw-Stop-Sig"));
    assert.ok(r.curl.includes("/stop"));
  });

  it("token-only without secret", () => {
    const r = buildStopSignResult({ gateway: { token: "t" } }, {});
    assert.equal(r.hasSecret, false);
    assert.equal(r.sig, null);
    assert.equal(r.headers.Authorization, "Bearer t");
  });
});
