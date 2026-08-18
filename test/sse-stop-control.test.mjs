import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleSseStopControl } from "../src/gateway/sse-stop-control.mjs";
import { buildStopControlMessage } from "../src/gateway/stop-control-auth.mjs";
import { getLastDrain } from "../src/gateway/last-drain.mjs";

describe("SSE stop control", () => {
  it("stamps channel=sse and authMethod on lastDrain", async () => {
    const cfg = { gateway: { token: "tok", stopHmacSecret: "sekrit" } };
    const msg = buildStopControlMessage(cfg, { type: "stop", action: "stop-all" });
    const out = [];
    const r = await handleSseStopControl(msg, cfg, (p) => out.push(p));
    assert.equal(r.handled, true);
    assert.equal(r.ok, true);
    assert.equal(out[0].channel, "sse");
    assert.ok(out[0].authMethod);
    const last = getLastDrain();
    assert.equal(last.channel, "sse");
    assert.ok(last.authMethod);
  });
});
