import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { closeAllWebSockets, wsClientCount } from "../src/gateway/ws-hub.mjs";
import { setSSEFanout, closeAllSSEFanout } from "../src/gateway/sse-fanout-registry.mjs";
import { createSSEFanout, createMockSSEResponse } from "../src/gateway/sse-fanout.mjs";
import { killAll, registerSession, listActiveSessions } from "../src/agent/session-control.mjs";

describe("killAll closes WS + SSE", () => {
  it("closeAllWebSockets returns ok", () => {
    const r = closeAllWebSockets("test");
    assert.equal(r.ok, true);
    assert.equal(wsClientCount(), 0);
  });

  it("killAll drains SSE rooms and sessions", async () => {
    const hub = createSSEFanout();
    setSSEFanout(hub);
    hub.subscribe("agent:t1", createMockSSEResponse().res, { hello: false });
    assert.equal(hub.stats().subscribers, 1);

    registerSession("sess_kill_test", { label: "t" });
    assert.ok(listActiveSessions().some((s) => s.sessionId === "sess_kill_test"));

    const r = await killAll({ stopComputer: false, closeWs: true, closeSse: true });
    assert.equal(r.ok, true);
    assert.ok(r.sse);
    assert.equal(r.sse.subscribers, 1);
    assert.ok(r.ws?.ok !== false);
    assert.equal(hub.stats().subscribers, 0);
  });
});
