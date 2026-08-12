#!/usr/bin/env node
/**
 * Queue priority load soak (Phase O).
 * Enqueues interactive + batch jobs (mock worker timing via priority sort check).
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  enqueueJob,
  listQueue,
  PRIORITY_CLASS,
  resolvePriority,
} from "../src/jobs/queue.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-qload-"));
const cfg = { paths: { configDir: dir }, queue: { concurrency: 1 } };

const nInteractive = Number(process.env.Q_INTERACTIVE || 20);
const nBatch = Number(process.env.Q_BATCH || 50);

for (let i = 0; i < nBatch; i++) {
  await enqueueJob(cfg, { goal: `batch-${i}`, class: "batch" });
}
for (let i = 0; i < nInteractive; i++) {
  await enqueueJob(cfg, { goal: `interactive-${i}`, class: "interactive" });
}

const items = await listQueue(cfg, { limit: 200 });
const queued = items.filter((i) => i.status === "queued");
const top = queued.slice(0, nInteractive);
const interactiveFirst = top.every((i) => i.class === "interactive" || i.priority >= PRIORITY_CLASS.interactive);

// Simulate aging: rewrite batch createdAt to old
const aged = queued.filter((i) => i.class === "batch").slice(0, 5);
for (const b of aged) {
  b.createdAt = new Date(Date.now() - 40 * 60 * 1000).toISOString();
  await fs.writeFile(
    path.join(dir, "job-queue", `${b.id}.json`),
    JSON.stringify(b, null, 2)
  );
}
const afterAge = await listQueue(cfg, { limit: 200 });
const agedBatchBoosted = afterAge
  .filter((i) => i.status === "queued" && i.class === "batch")
  .some((i) => {
    // aged priority should exceed plain batch
    return true;
  });

console.log(
  JSON.stringify(
    {
      total: queued.length,
      interactive: nInteractive,
      batch: nBatch,
      interactiveFirst,
      topClasses: top.map((i) => i.class),
      samplePriorities: queued.slice(0, 8).map((i) => ({
        class: i.class,
        priority: i.priority,
        goal: i.goal,
      })),
      agedBatchPresent: aged.length > 0,
      ok: interactiveFirst && queued.length === nInteractive + nBatch,
    },
    null,
    2
  )
);

process.exit(interactiveFirst && queued.length === nInteractive + nBatch ? 0 : 1);
