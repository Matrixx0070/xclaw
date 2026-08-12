
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { enqueueJob, pauseQueue, queueStats, listDeadLetter } from "../src/jobs/queue.mjs";

describe("queue stats", () => {
  it("counts statuses", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-qs-"));
    const cfg = { paths: { configDir: dir }, agent: { maxTurns: 1 } };
    pauseQueue();
    await enqueueJob(cfg, { goal: "a" });
    const s = await queueStats(cfg);
    assert.ok(s.queued >= 1);
    assert.equal(typeof s.total, "number");
    const dead = await listDeadLetter(cfg);
    assert.ok(Array.isArray(dead));
  });
});
