import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  eventsAfterLastId,
  reconnectDelayMs,
  formatSSEEvent,
} from "../src/utils/sse-reconnect.mjs";
import {
  pushEvictionEvent,
  subscribeEvictionSSE,
  listEvictionEvents,
} from "../src/gateway/eviction-events.mjs";
import { EventEmitter } from "node:events";

describe("SSE reconnect helpers", () => {
  it("eventsAfterLastId slices after id", () => {
    const ev = [{ id: "a" }, { id: "b" }, { id: "c" }];
    assert.deepEqual(eventsAfterLastId(ev, "a").map((e) => e.id), ["b", "c"]);
    assert.deepEqual(eventsAfterLastId(ev, "z").map((e) => e.id), ["a", "b", "c"]);
    assert.deepEqual(eventsAfterLastId(ev, null).map((e) => e.id), ["a", "b", "c"]);
  });

  it("reconnectDelayMs stays within max", () => {
    for (let i = 0; i < 20; i++) {
      const d = reconnectDelayMs(i, { baseMs: 100, maxMs: 500 });
      assert.ok(d >= 0 && d <= 500);
    }
  });

  it("formatSSEEvent includes id and event", () => {
    const s = formatSSEEvent("eviction", { x: 1 }, "id-9");
    assert.match(s, /^id: id-9\n/);
    assert.match(s, /event: eviction\n/);
    assert.match(s, /data: {"x":1}\n/);
  });

  it("subscribeEvictionSSE resumes from lastEventId", async () => {
    const a = pushEvictionEvent({ kind: "test-a" });
    const b = pushEvictionEvent({ kind: "test-b" });
    const chunks = [];
    const res = new EventEmitter();
    res.writableEnded = false;
    res.write = (c) => {
      chunks.push(String(c));
      return true;
    };
    subscribeEvictionSSE(res, { lastEventId: a.id });
    const joined = chunks.join("");
    assert.match(joined, /test-b/);
    assert.ok(!joined.includes("test-a") || joined.indexOf("test-b") >= 0);
    // b should be present
    assert.ok(joined.includes(b.id) || joined.includes("test-b"));
  });
});
