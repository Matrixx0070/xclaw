import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authorizeStop, signStopBody } from "../src/gateway/stop-auth.mjs";

describe("POST /stop HMAC", () => {
  it("rejects bad signature when secret set", () => {
    const r = authorizeStop(
      { headers: { authorization: "Bearer secret", "x-xclaw-stop-sig": "00".repeat(32) }, body: {} },
      { gateway: { token: "secret", stopHmacSecret: "hmac" } }
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, "STOP_HMAC_INVALID");
  });

  it("accepts valid signature", () => {
    const body = JSON.stringify({});
    const sig = signStopBody("hmac", body);
    const r = authorizeStop(
      { headers: { authorization: "Bearer secret", "x-xclaw-stop-sig": sig }, body: {} },
      { gateway: { token: "secret", stopHmacSecret: "hmac" } }
    );
    assert.equal(r.ok, true);
  });
});
