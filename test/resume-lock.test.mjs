import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  saveMidRunCheckpoint,
  loadCheckpoint,
  tryAcquireResumeLock,
  releaseResumeLock,
  markCheckpointResumed,
  listCheckpoints,
  resumeJobFromCheckpoint,
} from "../src/jobs/checkpoint.mjs";

describe("resume lock / mark resumed", () => {
  let cfg;
  before(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-rlock-"));
    cfg = { paths: { configDir: dir } };
  });

  it("acquire/release lock", () => {
    assert.equal(tryAcquireResumeLock("j1"), true);
    assert.equal(tryAcquireResumeLock("j1"), false);
    releaseResumeLock("j1");
    assert.equal(tryAcquireResumeLock("j1"), true);
    releaseResumeLock("j1");
  });

  it("markCheckpointResumed clears midRun", async () => {
    await saveMidRunCheckpoint(cfg, {
      id: "job_lock_1",
      goal: "g",
      workspace: "/tmp/ws",
      turns: 3,
      maxTurns: 12,
    });
    await markCheckpointResumed(cfg, "job_lock_1", { resumedBy: "job_lock_1_r" });
    const cp = await loadCheckpoint(cfg, "job_lock_1");
    assert.equal(cp.status, "resumed");
    assert.equal(cp.midRun, false);
    assert.equal(cp.resumedBy, "job_lock_1_r");
  });

  it("list excludes need — resumed still listed but status resumed", async () => {
    const list = await listCheckpoints(cfg);
    const hit = list.find((x) => x.id === "job_lock_1");
    assert.ok(hit);
    assert.equal(hit.status, "resumed");
  });

  it("resume of already resumed is no-op without force", async () => {
    const r = await resumeJobFromCheckpoint(cfg, "job_lock_1");
    assert.equal(r.note, "already_resumed");
    assert.equal(r.resumed, false);
  });

  it("cross-process file lock exclusive", async () => {
    const a = await tryAcquireResumeLock("job_file_lock", cfg);
    assert.equal(a, true);
    const b = await tryAcquireResumeLock("job_file_lock", cfg);
    assert.equal(b, false);
    await releaseResumeLock("job_file_lock", cfg);
    const c = await tryAcquireResumeLock("job_file_lock", cfg);
    assert.equal(c, true);
    await releaseResumeLock("job_file_lock", cfg);
  });
});
