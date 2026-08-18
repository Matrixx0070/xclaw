import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isStopControlBody, handleWsStopControl } from "../src/gateway/ws-stop-control.mjs";

describe("WS stop control", () => {
  it("detects stop bodies", () => {
    assert.equal(isStopControlBody({ type: "stop" }), true);
    assert.equal(isStopControlBody({ type: "ping" }), false);
  });

  it("rejects unauthenticated stop when token required", async () => {
    const out = [];
    const r = await handleWsStopControl(
      { type: "stop" },
      { gateway: { token: "secret" } },
      (p) => out.push(p)
    );
    assert.equal(r.handled, true);
    assert.equal(r.ok, false);
    assert.equal(out[0].type, "stop_result");
    assert.equal(out[0].ok, false);
  });
});
