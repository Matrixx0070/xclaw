import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeTextFrame, decodeFrames } from "../src/gateway/ws-hub.mjs";
import { createBoundedQueue, DropPolicy } from "../src/shared/bounded-queue.mjs";

describe("ws hub outbound helpers", () => {
  it("roundtrips text frame", () => {
    const frame = encodeTextFrame(JSON.stringify({ type: "ping" }));
    const { messages } = decodeFrames(frame);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, "text");
  });

  it("outbound max drops oldest under flood", () => {
    const q = createBoundedQueue({ maxsize: 3, policy: DropPolicy.DROP_OLDEST });
    for (let i = 0; i < 5; i++) q.push(Buffer.from(String(i)));
    assert.equal(q.size, 3);
    assert.equal(q.metrics.dropped, 2);
  });
});
