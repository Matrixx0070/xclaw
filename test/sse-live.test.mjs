import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMockSSEResponse, createSSEFanout } from "../src/gateway/sse-fanout.mjs";
import {
  setSSEFanout,
  getSSEFanout,
  closeAllSSEFanout,
  subscribeLiveSSE,
} from "../src/gateway/sse-fanout-registry.mjs";

describe("live SSE registry", () => {
  it("subscribeLiveSSE is killable via closeAll", () => {
    const hub = createSSEFanout();
    setSSEFanout(hub);
    subscribeLiveSSE(createMockSSEResponse(), "job-9");
    assert.equal(getSSEFanout().stats().rooms["job-9"], 1);
    closeAllSSEFanout("kill_all");
    assert.equal(getSSEFanout().stats().subscribers, 0);
  });
});
