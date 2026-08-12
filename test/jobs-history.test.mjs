import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { recordJob, listJobs, getJob } from "../src/jobs/history.mjs";
import { recordSkillOutcome, loadSkillStats, bumpSkillVersion } from "../src/skills/registry.mjs";

describe("job history", () => {
  it("records and lists jobs", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-jh-"));
    const cfg = { paths: { configDir: dir } };
    const job = {
      id: "job_test_1",
      goal: "test goal",
      status: "succeeded",
      pass: true,
      turns: 2,
      toolCalls: 1,
      toolErrors: 0,
      wallMs: 100,
      evidence: [{ id: "e1", summary: "ok" }],
      verify: { ok: true, results: [] },
    };
    await recordJob(cfg, job);
    const list = await listJobs(cfg, { limit: 5 });
    assert.ok(list.some((j) => j.id === "job_test_1"));
    const full = await getJob(cfg, "job_test_1");
    assert.equal(full.pass, true);
  });
});

describe("skill registry", () => {
  it("tracks success rate and version bump", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-sk-"));
    const cfg = { paths: { configDir: dir } };
    await recordSkillOutcome(cfg, ["example-shell"], true, 3);
    await recordSkillOutcome(cfg, ["example-shell"], false, 5);
    const stats = await loadSkillStats(cfg);
    const s = stats.skills["example-shell"];
    assert.equal(s.runs, 2);
    assert.equal(s.successes, 1);
    assert.ok(Math.abs(s.successRate - 0.5) < 1e-9);
    const bumped = await bumpSkillVersion(cfg, "example-shell", "eval improve");
    assert.equal(bumped.version, 2);
  });
});
