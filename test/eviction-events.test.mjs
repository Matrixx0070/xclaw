import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  pushEvictionEvent,
  listEvictionEvents,
  evictionBufferMetrics,
} from "../src/gateway/eviction-events.mjs";

describe("eviction-events bounded buffer", () => {
  it("retains events and exposes metrics", () => {
    const e = pushEvictionEvent({ type: "test", reason: "unit" });
    assert.ok(e.id);
    const list = listEvictionEvents({ limit: 5 });
    assert.ok(list.some((x) => x.id === e.id));
    const m = evictionBufferMetrics();
    assert.ok(m.received >= 1);
    assert.ok(m.enqueued >= 1);
  });

  it("drops oldest when over capacity", () => {
    const before = evictionBufferMetrics().dropped;
    for (let i = 0; i < 120; i++) {
      pushEvictionEvent({ type: "flood", i });
    }
    const m = evictionBufferMetrics();
    assert.ok(m.dropped > before || m.maxDepth <= 100);
    assert.ok(listEvictionEvents({ limit: 200 }).length <= 100);
  });
});
