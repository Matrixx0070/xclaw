/**
 * Crash mid-job: durable mid-run checkpoint loads and can be marked resumed.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  saveMidRunCheckpoint,
  loadCheckpoint,
  markCheckpointResumed,
  listCheckpoints,
  RESUME_CODES,
} from "../src/jobs/checkpoint.mjs";

describe("checkpoint crash resume", () => {
  let tmp;
  let cfg;

  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-cp-crash-"));
    cfg = { paths: { configDir: tmp } };
  });

  after(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("mid-run snapshot survives 'crash' and resumes", async () => {
    const jobId = "job-crash-1";
    await saveMidRunCheckpoint(cfg, {
      id: jobId,
      goal: "finish the report",
      workspace: path.join(tmp, "ws"),
      turns: 3,
      text: "partial progress...",
      toolTrace: [{ name: "xclaw_bash", status: "ok" }],
      maxTurns: 12,
    });

    const cp = await loadCheckpoint(cfg, jobId);
    assert.equal(cp.id, jobId);
    assert.equal(cp.status, "running");
    assert.equal(cp.midRun, true);
    assert.equal(cp.turns, 3);
    assert.ok(String(cp.goal).includes("report"));

    await markCheckpointResumed(cfg, jobId, { resumedBy: "test-resume" });
    const after = await loadCheckpoint(cfg, jobId);
    assert.equal(after.status, "resumed");
    assert.equal(after.resumedBy, "test-resume");
    assert.ok(after.resumedAt);

    const listed = await listCheckpoints(cfg, { limit: 10 });
    assert.ok(listed.some((c) => c.id === jobId));
  });

  it("missing checkpoint throws NOT_FOUND", async () => {
    await assert.rejects(
      () => loadCheckpoint(cfg, "no-such-job"),
      (err) => err.code === RESUME_CODES.NOT_FOUND
    );
  });
});
