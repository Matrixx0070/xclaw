import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  signStopBody,
  canonicalizeStopBody,
  verifyStopSignature,
} from "../src/gateway/stop-auth.mjs";

describe("stop HMAC canonical body", () => {
  it("same sig for key-order shuffled objects", () => {
    const secret = "sekrit";
    const a = { type: "stop", action: "stop-all", dryRun: true };
    const b = { dryRun: true, action: "stop-all", type: "stop" };
    assert.equal(canonicalizeStopBody(a), canonicalizeStopBody(b));
    assert.equal(signStopBody(secret, a), signStopBody(secret, b));
  });

  it("whitespace-insensitive string body", () => {
    const secret = "s";
    const pretty = '{\n  "type": "stop",\n  "action": "stop-all"\n}';
    const compact = '{"action":"stop-all","type":"stop"}';
    assert.equal(signStopBody(secret, pretty), signStopBody(secret, compact));
  });

  it("verifyStopSignature accepts reordered body", () => {
    const secret = "hmac-key";
    const cfg = { gateway: { stopHmacSecret: secret, stopHmac: true } };
    const body = { z: 1, type: "stop", a: 2 };
    const sig = signStopBody(secret, body);
    const r = verifyStopSignature(
      { headers: { "x-xclaw-stop-sig": sig } },
      cfg,
      JSON.stringify({ a: 2, type: "stop", z: 1 })
    );
    assert.equal(r.ok, true);
  });
});
