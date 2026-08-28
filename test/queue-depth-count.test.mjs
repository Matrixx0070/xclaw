/**
 * The number admission compares to maxDepth must be the depth of the queue,
 * not the size of a page of it. The bound it is compared against is covered
 * separately in admission-bound-race.test.mjs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { countQueued, enqueueJob } from "../src/jobs/queue.mjs";

async function seedQueued(n) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-depth-"));
  const qdir = path.join(dir, "job-queue");
  await fs.mkdir(qdir, { recursive: true });
  const at = new Date().toISOString();
  const writes = [];
  for (let i = 0; i < n; i++) {
    const id = `q_seed_${String(i).padStart(4, "0")}`;
    writes.push(
      fs.writeFile(
        path.join(qdir, `${id}.json`),
        JSON.stringify({
          id,
          goal: `seed ${i}`,
          status: "queued",
          priority: 0,
          attempts: 0,
          createdAt: at,
          enqueuedAt: at,
        })
      )
    );
  }
  await Promise.all(writes);
  return dir;
}

describe("queue depth is counted, not paged", () => {
  it("counts every queued job past the listQueue page size", async () => {
    const dir = await seedQueued(501);
    const cfg = { paths: { configDir: dir } };
    assert.equal(
      await countQueued(cfg),
      501,
      "the depth count saturated — listQueue's display limit is being used as a census"
    );
  });

  it("refuses admission when the true depth has reached maxDepth", async () => {
    const dir = await seedQueued(501);
    const cfg = { paths: { configDir: dir }, queue: { maxDepth: 501 } };
    await assert.rejects(
      () => enqueueJob(cfg, { goal: "one past the cap" }),
      (err) => {
        assert.equal(
          err.code,
          "QUEUE_FULL",
          "the finite buffer admitted past maxDepth — above a 500-job queue it can never refuse"
        );
        return true;
      }
    );
  });
});
