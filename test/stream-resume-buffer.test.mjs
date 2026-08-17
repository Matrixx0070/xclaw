import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StreamEventLog } from "../src/gateway/stream-resume.mjs";

describe("StreamEventLog bounded buffer", () => {
  it("drops oldest beyond capacity", () => {
    const log = new StreamEventLog("t1", { capacity: 5, ttlMs: 60_000 });
    for (let i = 0; i < 12; i++) log.append("message", { i });
    assert.equal(log.events.length, 5);
    assert.ok(log.bufferMetrics().dropped >= 7);
    assert.equal(log.events[0].payload.i, 7);
  });

  it("after lastEventId works", () => {
    const log = new StreamEventLog("t2", { capacity: 10, ttlMs: 60_000 });
    const a = log.append("a", { n: 1 });
    log.append("b", { n: 2 });
    const rest = log.after(a.id);
    assert.equal(rest.length, 1);
    assert.equal(rest[0].payload.n, 2);
  });

  it("snapshot includes drop counts", () => {
    const log = new StreamEventLog("t3", { capacity: 2, ttlMs: 60_000 });
    log.append("x", {});
    log.append("y", {});
    log.append("z", {});
    const s = log.snapshot();
    assert.equal(s.eventCount, 2);
    assert.ok(s.dropped >= 1);
  });
});
