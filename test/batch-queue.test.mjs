
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { enqueueFromFile } from "../src/jobs/batch.mjs";
import { listQueue } from "../src/jobs/queue.mjs";

describe("batch enqueue", () => {
  it("enqueues from JSON array file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-batch-"));
    const file = path.join(dir, "jobs.json");
    await fs.writeFile(
      file,
      JSON.stringify([{ goal: "batch goal one", priority: 2 }, { goal: "batch goal two" }])
    );
    const cfg = { paths: { configDir: dir }, agent: { maxTurns: 1 }, security: { autoApprove: true } };
    const out = await enqueueFromFile(cfg, file);
    assert.equal(out.count, 2);
    assert.equal(out.errors.length, 0);
    const list = await listQueue(cfg);
    assert.ok(list.length >= 2);
  });
});
