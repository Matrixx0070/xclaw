import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  handsFreeConfigOverlay,
  handsFreeStatus,
  runEvolutionTick,
} from "../src/autonomy/self-evolve.mjs";
import { saveMidRunCheckpoint, markCheckpointResumed } from "../src/jobs/checkpoint.mjs";

describe("self-evolution / hands-free", () => {
  it("overlay enables heartbeat and evolve resume", () => {
    const o = handsFreeConfigOverlay();
    assert.equal(o.autonomy.level, "full");
    assert.equal(o.autonomy.heartbeat.enabled, true);
    assert.equal(o.autonomy.evolve.autoResume, true);
    assert.equal(o.autonomy.evolve.autoPromote, false);
    assert.equal(o.harness.groundHard, true);
  });

  it("status returns structure", async () => {
    const st = await handsFreeStatus({
      profile: "lab",
      autonomy: { level: "lab" },
    });
    assert.ok(st.level);
    assert.ok(Array.isArray(st.blockers));
    assert.ok(st.evolve);
  });

  it("dry-run tick does not throw", async () => {
    const r = await runEvolutionTick(
      { profile: "lab", autonomy: { level: "lab", evolve: { autoResume: true } } },
      { dryRun: true }
    );
    assert.ok(r.status);
    assert.ok(Array.isArray(r.actions));
  });
});

describe("self-evolution offline fixtures", () => {
  let cfg;
  let dir;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-evolve-fx-"));
    cfg = {
      profile: "lab",
      paths: { configDir: dir },
      autonomy: {
        level: "lab",
        evolve: { autoResume: true, autoPromote: false, maxAutoResume: 2 },
      },
    };
  });

  it("dry-run tick plans resume for running mid-run checkpoint", async () => {
    await saveMidRunCheckpoint(cfg, {
      id: "job_fx_run_1",
      goal: "fixture goal",
      workspace: path.join(dir, "ws"),
      turns: 3,
      maxTurns: 12,
    });
    const r = await runEvolutionTick(cfg, { dryRun: true });
    const resumes = r.actions.filter((a) => a.type === "resume");
    assert.ok(
      resumes.some((a) => a.id === "job_fx_run_1" && a.dryRun === true),
      `expected resume plan for job_fx_run_1, got ${JSON.stringify(r.actions)}`
    );
  });

  it("does not plan resume for already resumed checkpoint", async () => {
    await saveMidRunCheckpoint(cfg, {
      id: "job_fx_done_1",
      goal: "done",
      workspace: path.join(dir, "ws"),
      turns: 2,
      maxTurns: 10,
    });
    await markCheckpointResumed(cfg, "job_fx_done_1", {
      resumedBy: "job_fx_done_1_resume_x",
    });
    const r = await runEvolutionTick(cfg, { dryRun: true });
    const resumes = r.actions.filter(
      (a) => a.type === "resume" && a.id === "job_fx_done_1"
    );
    assert.equal(resumes.length, 0);
  });

  it("supervised level does not auto-resume", async () => {
    await saveMidRunCheckpoint(cfg, {
      id: "job_fx_sup_1",
      goal: "sup",
      workspace: path.join(dir, "ws"),
      turns: 1,
      maxTurns: 8,
    });
    const supervised = {
      ...cfg,
      autonomy: { ...cfg.autonomy, level: "supervised" },
    };
    const r = await runEvolutionTick(supervised, { dryRun: true });
    const resumes = r.actions.filter((a) => a.type === "resume");
    assert.equal(
      resumes.filter((a) => a.id === "job_fx_sup_1").length,
      0
    );
  });

  it("autoResume false skips resume phase", async () => {
    await saveMidRunCheckpoint(cfg, {
      id: "job_fx_block_1",
      goal: "blocked",
      workspace: path.join(dir, "ws"),
      turns: 1,
      maxTurns: 8,
    });
    const r = await runEvolutionTick(cfg, {
      dryRun: true,
      autoResume: false,
    });
    assert.equal(
      r.actions.filter((a) => a.type === "resume" && a.id === "job_fx_block_1")
        .length,
      0
    );
  });
});
