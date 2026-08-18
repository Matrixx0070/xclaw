import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSSEFanout, createMockSSEResponse } from "../src/gateway/sse-fanout.mjs";
import { setSSEFanout, closeAllSSEFanout } from "../src/gateway/sse-fanout-registry.mjs";

describe("SSE kill-switch fanout", () => {
  it("closeRoom ends subscribers in that room only", () => {
    const hub = createSSEFanout();
    const a = createMockSSEResponse();
    const b = createMockSSEResponse();
    hub.subscribe("job-1", a);
    hub.subscribe("job-2", b);
    const r = hub.closeRoom("job-1", "kill");
    assert.equal(r.closed, 1);
    assert.equal(hub.stats().rooms["job-2"], 1);
    assert.equal(hub.stats().rooms["job-1"], undefined);
  });

  it("closeAllSSEFanout drains registry", () => {
    const hub = createSSEFanout();
    hub.subscribe("r", createMockSSEResponse());
    setSSEFanout(hub);
    const r = closeAllSSEFanout("kill_all");
    assert.ok(r.subscribers >= 1);
    assert.equal(hub.stats().subscribers, 0);
  });
});
