/**
 * Drop + reconnect: replay only events after Last-Event-ID.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  getOrCreateStreamLog,
  deleteStreamLog,
  newStreamId,
} from "../src/gateway/stream-resume.mjs";

describe("stream drop/reconnect", () => {
  const ids = [];
  after(() => {
    for (const id of ids) deleteStreamLog(id);
  });

  it("resumes after drop without duplicating seen events", () => {
    const streamId = newStreamId();
    ids.push(streamId);
    const log = getOrCreateStreamLog(streamId, { capacity: 50, ttlMs: 60_000 });
    const produced = [];
    for (let i = 1; i <= 5; i++) {
      produced.push(log.append({ type: "token", n: i }));
    }
    assert.equal(produced.length, 5);
    const lastSeen = produced[1].id;
    const replay =
      typeof log.after === "function"
        ? log.after(lastSeen)
        : log.eventsAfterLastId?.(lastSeen);
    const events = replay || [];
    assert.ok(events.length >= 3, `expected replay >=3, got ${events.length}`);
    const idsReplay = events.map((e) => e.id);
    assert.ok(!idsReplay.includes(lastSeen), "must not replay last-seen id");
    assert.ok(idsReplay.includes(produced[4].id));
  });
});
