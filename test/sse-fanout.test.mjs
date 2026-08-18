/**
 * SSE multi-subscriber fanout — ordering + no cross-talk.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createSSEFanout,
  createMockSSEResponse,
} from "../src/gateway/sse-fanout.mjs";

describe("SSE fanout", () => {
  it("delivers ordered events to all room subscribers", () => {
    const hub = createSSEFanout();
    const a = createMockSSEResponse();
    const b = createMockSSEResponse();
    hub.subscribe("job-1", a.res, { hello: false });
    hub.subscribe("job-1", b.res, { hello: false });

    hub.publish("job-1", "turn", { n: 1 });
    hub.publish("job-1", "turn", { n: 2 });
    hub.publish("job-1", "done", { ok: true });

    const ea = a.events().filter((e) => e.event === "turn" || e.event === "done");
    const eb = b.events().filter((e) => e.event === "turn" || e.event === "done");
    assert.equal(ea.length, 3);
    assert.equal(eb.length, 3);
    assert.deepEqual(
      ea.map((e) => e.data.n ?? e.data.ok),
      [1, 2, true]
    );
    assert.deepEqual(
      eb.map((e) => e.data.n ?? e.data.ok),
      [1, 2, true]
    );
    const ids = ea.map((e) => Number(e.id));
    assert.ok(ids[0] < ids[1] && ids[1] < ids[2]);
  });

  it("no cross-talk between rooms", () => {
    const hub = createSSEFanout();
    const r1 = createMockSSEResponse();
    const r2 = createMockSSEResponse();
    hub.subscribe("room-a", r1.res, { hello: false });
    hub.subscribe("room-b", r2.res, { hello: false });

    hub.publish("room-a", "secret", { room: "a" });
    hub.publish("room-b", "secret", { room: "b" });

    const e1 = r1.events().filter((e) => e.event === "secret");
    const e2 = r2.events().filter((e) => e.event === "secret");
    assert.equal(e1.length, 1);
    assert.equal(e2.length, 1);
    assert.equal(e1[0].data.room, "a");
    assert.equal(e2[0].data.room, "b");
  });

  it("drops closed subscribers", () => {
    const hub = createSSEFanout();
    const live = createMockSSEResponse();
    const dead = createMockSSEResponse();
    hub.subscribe("x", live.res, { hello: false });
    hub.subscribe("x", dead.res, { hello: false });
    dead.res.destroy();

    const r = hub.publish("x", "ping", { ok: 1 });
    assert.equal(r.delivered, 1);
    assert.equal(hub.stats().subscribers, 1);
  });
});
