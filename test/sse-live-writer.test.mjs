import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMockSSEResponse, createSSEFanout } from "../src/gateway/sse-fanout.mjs";
import {
  setSSEFanout,
  getSSEFanout,
  closeAllSSEFanout,
  subscribeLiveSSE,
} from "../src/gateway/sse-fanout-registry.mjs";

describe("live stream rooms", () => {
  it("session room is killable", () => {
    const hub = createSSEFanout();
    setSSEFanout(hub);
    subscribeLiveSSE(createMockSSEResponse(), "chat:abc");
    assert.equal(getSSEFanout().stats().rooms["chat:abc"], 1);
    closeAllSSEFanout("kill_all");
    assert.equal(getSSEFanout().stats().subscribers, 0);
  });
});
