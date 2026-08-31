import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  saveSoakCheckpoint,
  loadSoakCheckpoint,
  listSoakJobs,
  jobDir,
} from "../src/eval/horizon-soak-checkpoint.mjs";
import {
  resetSoakResumeMetrics,
  getSoakResumeTotal,
} from "../src/eval/horizon-soak-resume-metrics.mjs";
import { runHorizonLive } from "../src/eval/horizon-live.mjs";
import { doctorHorizon } from "../src/cli/doctor-horizon.mjs";

describe("horizon soak checkpoint", () => {
  it("round-trip save/load with fsync path", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-soak-"));
    const saved = await saveSoakCheckpoint(
      "job-1",
      { turns: 3, usedUsd: 0.4, goals: ["finish"] },
      { base }
    );
    assert.equal(saved.turns, 3);
    const loaded = await loadSoakCheckpoint("job-1", { base });
    assert.equal(loaded.turns, 3);
    assert.equal(loaded.usedUsd, 0.4);
    assert.deepEqual(loaded.goals, ["finish"]);
    const jobs = await listSoakJobs({ base });
    assert.ok(jobs.some((j) => j.jobId === "job-1"));
  });

  it("block then resume under raised cap", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-soak2-"));
    process.env.XAI_API_KEY = process.env.XAI_API_KEY || "test-key-not-real";
    resetSoakResumeMetrics();

    const blocked = await runHorizonLive({
      requireLive: true,
      soakJobId: "resume-1",
      soakBase: base,
      maxUsd: 0.01,
      usedUsd: 1,
      maxTurns: 8,
      runAgent: async () => ({ ok: true }),
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.mode, "soak_blocked");
    const cp1 = await loadSoakCheckpoint("resume-1", { base });
    assert.ok(cp1.usedUsd >= 1);

    const resumed = await runHorizonLive({
      requireLive: true,
      soakJobId: "resume-1",
      soakBase: base,
      maxUsd: 5,
      maxTurns: 8,
      runAgent: async () => ({ ok: true }),
    });
    assert.equal(resumed.ok, true);
    assert.equal(resumed.mode, "live");
    assert.ok(getSoakResumeTotal() >= 1);
    const cp2 = await loadSoakCheckpoint("resume-1", { base });
    assert.ok(cp2.turns >= 1);
  });

  it("truncated checkpoint is skipped by list; load still throws", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-soak-trunc-"));
    const dir = jobDir("job-trunc", base);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "checkpoint.json"),
      '{"jobId":"job-trunc","turns":'
    );
    await assert.rejects(
      () => loadSoakCheckpoint("job-trunc", { base }),
      (e) => e instanceof SyntaxError
    );
    const jobs = await listSoakJobs({ base });
    assert.ok(Array.isArray(jobs));
    assert.equal(
      jobs.some((j) => j.jobId === "job-trunc"),
      false
    );
  });

  it("doctor lists soak jobs without throwing on checkout evidence", async () => {
    const d = await doctorHorizon({});
    assert.ok(Array.isArray(d.soakJobs));
    assert.equal(typeof d.soakJobCount, "number");
    assert.ok(d.metricsResume);
  });
});
