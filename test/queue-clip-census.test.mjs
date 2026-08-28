/**
 * Aggregates and sweeps over the queue must see the queue, not a page of it.
 *
 * queueStats, listDeadLetter, retryFailedQueue and clearCompletedQueue each
 * derived their input from listQueue(cfg, { limit: 500 }) — a display limit.
 * listQueue sorts queued items FIRST, so on a queue holding 500+ queued
 * records the page contains nothing else: stats saturate at 500 (feeding the
 * xclaw_queue_jobs Prometheus gauge), the dead-letter list is empty, retry
 * requeues nothing and clear removes nothing — every one of them reporting a
 * successful zero. Measured before the fix, 500 queued + 2 failed + 1
 * succeeded on disk: total=500, failed=0, deadLetter=0, removed=0, requeued=0.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  queueStats,
  listDeadLetter,
  retryFailedQueue,
  clearCompletedQueue,
} from "../src/jobs/queue.mjs";

async function seed() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-clip-"));
  const qdir = path.join(dir, "job-queue");
  await fs.mkdir(qdir, { recursive: true });
  const at = new Date().toISOString();
  const write = (id, extra) =>
    fs.writeFile(
      path.join(qdir, `${id}.json`),
      JSON.stringify({ id, goal: id, priority: 0, attempts: 0, createdAt: at, enqueuedAt: at, ...extra })
    );
  const w = [];
  for (let i = 0; i < 500; i++) w.push(write(`q_q${String(i).padStart(3, "0")}`, { status: "queued" }));
  w.push(write("q_fail_a", { status: "failed", attempts: 1, maxAttempts: 1 }));
  w.push(write("q_fail_b", { status: "failed", attempts: 1, maxAttempts: 1 }));
  w.push(write("q_done_a", { status: "succeeded" }));
  await Promise.all(w);
  return { paths: { configDir: dir } };
}

describe("queue aggregates see past the display page", () => {
  it("queueStats counts every record on disk", async () => {
    const cfg = await seed();
    const stats = await queueStats(cfg);
    assert.equal(stats.total, 503, "stats saturated at the page size");
    assert.equal(stats.failed, 2, "failed records past the page are invisible to stats");
    assert.equal(stats.deadLetter, 2);
  });

  it("listDeadLetter finds dead letters behind a 500-queued backlog", async () => {
    const cfg = await seed();
    assert.equal((await listDeadLetter(cfg)).length, 2, "the dead-letter list is a page, not a census");
  });

  it("clearCompletedQueue removes terminal records behind the backlog", async () => {
    const cfg = await seed();
    const { removed } = await clearCompletedQueue(cfg);
    assert.equal(removed, 3, "clear reported success while removing nothing");
  });

  it("retryFailedQueue requeues failed records behind the backlog", async () => {
    const cfg = await seed();
    const { requeued } = await retryFailedQueue(cfg);
    assert.equal(requeued, 2, "retry reported success while retrying nothing");
  });
});
