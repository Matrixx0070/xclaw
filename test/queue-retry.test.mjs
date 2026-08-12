
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { enqueueJob, retryFailedQueue, getQueueItem, pauseQueue } from "../src/jobs/queue.mjs";

describe("queue retry", () => {
  it("requeues failed items", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-qr-"));
    const cfg = { paths: { configDir: dir }, agent: { maxTurns: 1 } };
    pauseQueue();
    const item = await enqueueJob(cfg, { goal: "x", maxAttempts: 2 });
    // mark failed manually
    const fp = path.join(dir, "job-queue", item.id + ".json");
    const rec = JSON.parse(await fs.readFile(fp, "utf8"));
    rec.status = "failed";
    rec.attempts = 1;
    await fs.writeFile(fp, JSON.stringify(rec));
    const out = await retryFailedQueue(cfg);
    assert.equal(out.requeued, 1);
    const got = await getQueueItem(cfg, item.id);
    assert.equal(got.status, "queued");
    assert.equal(got.attempts, 0);
  });
});
