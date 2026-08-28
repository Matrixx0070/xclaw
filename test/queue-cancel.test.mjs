
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  enqueueJob,
  cancelQueueItem,
  clearCompletedQueue,
  getQueueItem,
  settleAfterRun,
} from "../src/jobs/queue.mjs";

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

describe("a cancel that lands while the job is running", () => {
  // Measured live on the 3.324.0 gateway (item q_mtd91tqe_231ef5a2):
  // POST /queue/<id>/cancel at t=0.3s returned "cancelled" and the record on
  // disk said "cancelled" at t=0.5s. processNext had been holding the item in
  // memory since t=0.3s, so its final save reverted the cancel to "queued"
  // (the retry branch) and the job RAN AGAIN — t=56s "running" attempt 2,
  // 62.7s of model time — ending "failed" at t=143s with the operator's
  // cancellation message overwritten. The run's last write must not overwrite
  // a decision another writer made while it was working.
  const ranAndFailed = () => ({
    id: "q_x",
    status: "queued", // the retry branch: what processNext decided in memory
    attempts: 1,
    maxAttempts: 2,
    error: "retrying after failure",
    finishedAt: null,
    result: { jobId: "job_x", pass: false, attempt: 1 },
  });
  const cancelledOnDisk = () => ({
    id: "q_x",
    status: "cancelled",
    attempts: 1,
    error: "cancelled while running (best-effort; worker may still finish)",
    finishedAt: "2026-08-28T17:53:36.000Z",
  });

  it("is not reverted by the finishing run, and never re-queued", () => {
    const out = settleAfterRun(ranAndFailed(), cancelledOnDisk());
    assert.equal(out.status, "cancelled");
    assert.match(out.error, /cancelled while running/);
    assert.equal(out.finishedAt, "2026-08-28T17:53:36.000Z");
  });

  it("still records what the in-flight attempt did", () => {
    const out = settleAfterRun(ranAndFailed(), cancelledOnDisk());
    assert.equal(out.attempts, 1);
    assert.deepEqual(out.result, { jobId: "job_x", pass: false, attempt: 1 });
  });

  it("leaves an untouched record exactly as the run decided", () => {
    const done = { id: "q_x", status: "succeeded", attempts: 1, result: { pass: true } };
    const out = settleAfterRun(done, { id: "q_x", status: "running", attempts: 1 });
    assert.deepEqual(out, done);
  });

  it("does not resurrect a record cleared while the run was in flight", () => {
    // clearCompletedQueue unlinks a cancelled item, so the file can be gone by
    // the time the run finishes; writing it back re-creates a job the operator
    // deleted.
    assert.equal(settleAfterRun(ranAndFailed(), null), null);
  });

  it("is wired into the run's final write", async () => {
    // processNext holds the item across a whole job and cannot be driven from a
    // test (runJob is a static import), so the call site is pinned as text.
    const src = await fs.readFile(new URL("../src/jobs/queue.mjs", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("async function processNext"));
    const tail = body.slice(0, body.indexOf("} finally {"));
    assert.match(tail, /const settled = settleAfterRun\(next, await getQueueItem\(cfg, next\.id\)\);/);
    assert.match(tail, /if \(settled\) await saveItem\(cfg, settled\);/);
    assert.doesNotMatch(tail.slice(tail.lastIndexOf("catch (err)")), /^\s*await saveItem\(cfg, next\);\s*$/m);
  });
});
