import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeStopControl,
  buildStopControlMessage,
} from "../src/gateway/stop-control-auth.mjs";

describe("WS/SSE stop control auth", () => {
  it("rejects unauthenticated control stop when token set", () => {
    const r = authorizeStopControl({ body: { type: "stop" } }, { gateway: { token: "s" } });
    assert.equal(r.ok, false);
  });

  it("accepts token + optional HMAC", () => {
    const cfg = { gateway: { token: "s", stopHmacSecret: "hmac" } };
    const msg = buildStopControlMessage(cfg, { type: "stop", action: "stop-all" });
    const r = authorizeStopControl(msg, cfg);
    assert.equal(r.ok, true);
  });
});
