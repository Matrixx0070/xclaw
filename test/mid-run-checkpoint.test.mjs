import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  saveMidRunCheckpoint,
  loadCheckpoint,
  listCheckpoints,
} from "../src/jobs/checkpoint.mjs";

describe("mid-run checkpoints", () => {
  let cfg;
  before(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-cp-"));
    cfg = { paths: { configDir: dir } };
  });

  it("saves running mid-run snapshot", async () => {
    const fp = await saveMidRunCheckpoint(cfg, {
      id: "job_mid_1",
      goal: "do things",
      workspace: "/tmp/ws",
      turns: 6,
      maxTurns: 24,
      toolTrace: [{ name: "bash", preview: "ok" }],
      evidence: [{ source: "tool", summary: "bash: ok" }],
    });
    assert.ok(fp.endsWith("job_mid_1.json"));
    const cp = await loadCheckpoint(cfg, "job_mid_1");
    assert.equal(cp.status, "running");
    assert.equal(cp.midRun, true);
    assert.equal(cp.turns, 6);
    assert.equal(cp.checkpointTurn, 6);
    assert.equal(cp.toolTrace.length, 1);
  });

  it("lists mid-run checkpoints", async () => {
    const list = await listCheckpoints(cfg);
    assert.ok(list.some((x) => x.id === "job_mid_1"));
  });

  it("atomic overwrite on later turn", async () => {
    await saveMidRunCheckpoint(cfg, {
      id: "job_mid_1",
      goal: "do things",
      workspace: "/tmp/ws",
      turns: 9,
      maxTurns: 24,
      toolTrace: [{ name: "write_file" }, { name: "bash" }],
    });
    const cp = await loadCheckpoint(cfg, "job_mid_1");
    assert.equal(cp.turns, 9);
    assert.equal(cp.status, "running");
  });
});
