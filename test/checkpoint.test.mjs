import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { saveCheckpoint, loadCheckpoint, classifyFailure } from "../src/jobs/checkpoint.mjs";

describe("checkpoints", () => {
  it("saves and loads", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-cp-"));
    const cfg = { paths: { configDir: dir } };
    await saveCheckpoint(cfg, {
      id: "job_test1",
      goal: "do x",
      workspace: dir,
      status: "failed",
      pass: false,
      turns: 3,
      text: "partial",
      error: "ECONNREFUSED",
      maxTurns: 12,
    });
    const cp = await loadCheckpoint(cfg, "job_test1");
    assert.equal(cp.goal, "do x");
    assert.equal(classifyFailure(cp.error), "transport");
  });
});
