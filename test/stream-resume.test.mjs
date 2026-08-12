import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  parseLastEventId,
  parseStreamId,
  newStreamId,
  getOrCreateStreamLog,
  deleteStreamLog,
  resolveStreamResume,
  createProducer,
  attachWriterToLog,
} from "../src/gateway/stream-resume.mjs";

function mockReq({ url = "/agent/run/stream", headers = {} } = {}) {
  return { url, headers };
}

describe("parseLastEventId", () => {
  it("reads Last-Event-ID header", () => {
    assert.equal(
      parseLastEventId(mockReq({ headers: { "last-event-id": "abc" } })),
      "abc"
    );
  });
  it("reads query param", () => {
    assert.equal(
      parseLastEventId(mockReq({ url: "/x?lastEventId=q1" })),
      "q1"
    );
  });
  it("reads body", () => {
    assert.equal(parseLastEventId(mockReq(), { lastEventId: "b1" }), "b1");
  });
  it("prefers header over body", () => {
    assert.equal(
      parseLastEventId(mockReq({ headers: { "last-event-id": "h" } }), {
        lastEventId: "b",
      }),
      "h"
    );
  });
});

describe("parseStreamId", () => {
  it("reads body.streamId", () => {
    assert.equal(parseStreamId(mockReq(), { streamId: "s_1" }), "s_1");
  });
  it("reads query", () => {
    assert.equal(parseStreamId(mockReq({ url: "/x?streamId=s_q" })), "s_q");
  });
});

describe("StreamEventLog + resume", () => {
  it("appends and after() slices", () => {
    const id = newStreamId("t");
    const log = getOrCreateStreamLog(id, { capacity: 10 });
    const a = log.append("lifecycle", { phase: "start" });
    const b = log.append("tool", { name: "xclaw_bash" });
    const c = log.append("result", { ok: true });
    const afterA = log.after(a.id);
    assert.equal(afterA.length, 2);
    assert.equal(afterA[0].id, b.id);
    assert.equal(afterA[1].id, c.id);
    deleteStreamLog(id);
  });

  it("createProducer records and pushes once", () => {
    const id = newStreamId("t");
    const log = getOrCreateStreamLog(id);
    const pushed = [];
    const produce = createProducer(log, (name, payload) => {
      pushed.push({ name, payload });
      return true;
    });
    produce("lifecycle", { phase: "start" });
    assert.equal(pushed.length, 1);
    assert.equal(log.events.length, 1);
    assert.equal(pushed[0].payload.streamId, id);
    assert.ok(pushed[0].payload.id);
    deleteStreamLog(id);
  });

  it("attachWriterToLog replays then live", () => {
    const id = newStreamId("t");
    const log = getOrCreateStreamLog(id);
    const e1 = log.append("lifecycle", { phase: "start" });
    log.append("tool", { name: "bash" });

    const received = [];
    const push = (name, payload) => {
      received.push({ name, ...payload });
      return true;
    };

    const { replayed, unsubscribe, record } = attachWriterToLog(log, {
      push,
      lastEventId: e1.id,
      live: true,
    });
    assert.equal(replayed, 1); // only tool after e1
    assert.equal(received[0].name, "bash"); // payload field from tool event
    assert.equal(received[0].resumed, true);

    // live fan-out via append from another producer path
    log.append("result", { ok: true });
    assert.ok(received.some((r) => r.name === "result"));

    unsubscribe();
    deleteStreamLog(id);
  });

  it("resolveStreamResume new vs resume", () => {
    const req = mockReq();
    const a = resolveStreamResume(req, { message: "hi" }, { prefix: "agent" });
    assert.equal(a.mode, "new");
    assert.ok(a.streamId.startsWith("agent_"));

    a.log.append("lifecycle", { phase: "start" });
    const firstId = a.log.events[0].id;
    a.log.append("tool", { n: 1 });

    const b = resolveStreamResume(
      mockReq({ headers: { "last-event-id": firstId } }),
      { streamId: a.streamId, resume: true },
      { prefix: "agent" }
    );
    assert.equal(b.mode, "resume-live");
    assert.equal(b.replay.length, 1);
    assert.equal(b.replay[0].event, "tool");

    a.log.markEnded("ended");
    const c = resolveStreamResume(
      mockReq(),
      { streamId: a.streamId, lastEventId: firstId },
      { prefix: "agent" }
    );
    assert.equal(c.mode, "replay-only");
    assert.equal(c.replay.length, 1);

    const d = resolveStreamResume(
      mockReq(),
      { streamId: "nope_missing", resume: true },
      { prefix: "agent" }
    );
    assert.equal(d.mode, "missing");

    deleteStreamLog(a.streamId);
  });
});
