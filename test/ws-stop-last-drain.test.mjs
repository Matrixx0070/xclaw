import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleWsStopControl } from "../src/gateway/ws-stop-control.mjs";
import { buildStopControlMessage } from "../src/gateway/stop-control-auth.mjs";
import { getLastDrain } from "../src/gateway/last-drain.mjs";

describe("WS stop lastDrain authMethod", () => {
  it("stamps channel=ws and authMethod on lastDrain", async () => {
    const cfg = {
      gateway: { token: "tok", stopHmacSecret: "sekrit" },
    };
    const msg = buildStopControlMessage(cfg, { type: "stop", action: "stop-all" });
    const out = [];
    const r = await handleWsStopControl(msg, cfg, (p) => out.push(p));
    assert.equal(r.handled, true);
    assert.equal(r.ok, true);
    assert.ok(out[0].authMethod);
    assert.equal(out[0].channel, "ws");
    const last = getLastDrain();
    assert.equal(last.channel, "ws");
    assert.ok(last.authMethod);
  });
});
