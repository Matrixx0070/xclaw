
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pauseQueue, resumeQueue, queueStatus } from "../src/jobs/queue.mjs";

describe("queue pause", () => {
  it("pause and resume flags", () => {
    const p = pauseQueue();
    assert.equal(p.paused, true);
    const r = resumeQueue({ queue: { concurrency: 1 }, paths: { configDir: "/tmp" } });
    assert.equal(r.paused, false);
    assert.equal(queueStatus({}).paused, false);
  });
});
