import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { drainStats, handleStopAll } from "../src/gateway/stop-route.mjs";
import { registerSession } from "../src/agent/session-control.mjs";
import { setSSEFanout } from "../src/gateway/sse-fanout-registry.mjs";
import { createSSEFanout, createMockSSEResponse } from "../src/gateway/sse-fanout.mjs";

describe("stop drain stats", () => {
  it("normalizes ws/sse counts", () => {
    const d = drainStats(
      { killedSessions: ["a", "b"], ws: { ok: true, closed: 3 }, sse: { subscribers: 4 } },
      ["a", "b"]
    );
    assert.equal(d.sessionsKilled, 2);
    assert.equal(d.wsClosed, 3);
    assert.equal(d.sseClosed, 4);
  });

  it("handleStopAll includes drain", async () => {
    const hub = createSSEFanout();
    setSSEFanout(hub);
    hub.subscribe("agent:drain", createMockSSEResponse().res, { hello: false });
    registerSession("sess_drain", { label: "t" });
    const r = await handleStopAll({}, null, { cfg: {} });
    assert.ok(r.drain);
    assert.ok(r.drain.sessionsKilled >= 1);
    assert.ok(r.drain.sseClosed >= 1);
  });
});
