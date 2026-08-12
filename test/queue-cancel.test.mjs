
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { enqueueJob, cancelQueueItem, clearCompletedQueue, getQueueItem } from "../src/jobs/queue.mjs";

describe("queue cancel/clear", () => {
  it("cancels queued item and clears completed", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-qc-"));
    const cfg = { paths: { configDir: dir }, agent: { maxTurns: 1 }, queue: { concurrency: 1 } };
    const item = await enqueueJob(cfg, { goal: "cancel me" });
    // pause so worker does not race
    const { pauseQueue } = await import("../src/jobs/queue.mjs");
    pauseQueue();
    const cancelled = await cancelQueueItem(cfg, item.id);
    assert.equal(cancelled.status, "cancelled");
    const cleared = await clearCompletedQueue(cfg);
    assert.ok(cleared.removed >= 1);
    const gone = await getQueueItem(cfg, item.id);
    assert.equal(gone, null);
  });
});
