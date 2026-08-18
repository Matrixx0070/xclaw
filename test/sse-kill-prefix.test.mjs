import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSSEFanout, createMockSSEResponse } from "../src/gateway/sse-fanout.mjs";
import { liveRoomName } from "../src/gateway/sse-live.mjs";
import { setSSEFanout, closeAllSSEFanout } from "../src/gateway/sse-fanout-registry.mjs";

describe("SSE kill-switch drains agent/swarm/webchat", () => {
  it("liveRoomName prefixes agent/swarm/webchat", () => {
    assert.equal(liveRoomName({ prefix: "agent", sessionId: "s1" }), "agent:s1");
    assert.equal(liveRoomName({ prefix: "swarm", swarmId: "sw" }), "swarm:sw");
    assert.equal(liveRoomName({ prefix: "webchat", sessionId: "c1" }), "webchat:c1");
  });

  it("closeAll drains all prefix rooms", () => {
    const hub = createSSEFanout();
    setSSEFanout(hub);
    const a = createMockSSEResponse();
    const b = createMockSSEResponse();
    const c = createMockSSEResponse();
    hub.subscribe("agent:a1", a.res, { hello: false });
    hub.subscribe("swarm:s1", b.res, { hello: false });
    hub.subscribe("webchat:w1", c.res, { hello: false });
    assert.equal(hub.stats().subscribers, 3);
    const r = closeAllSSEFanout("kill_all");
    assert.equal(r.rooms, 3);
    assert.equal(r.subscribers, 3);
    assert.equal(hub.stats().subscribers, 0);
    assert.ok(r.roomIds.includes("agent:a1"));
    assert.ok(r.roomIds.includes("swarm:s1"));
    assert.ok(r.roomIds.includes("webchat:w1"));
  });

  it("closeByPrefix only agent rooms", () => {
    const hub = createSSEFanout();
    hub.subscribe("agent:x", createMockSSEResponse().res, { hello: false });
    hub.subscribe("webchat:y", createMockSSEResponse().res, { hello: false });
    const r = hub.closeByPrefix("agent", "kill_agent");
    assert.equal(r.rooms, 1);
    assert.equal(hub.stats().subscribers, 1);
  });
});
