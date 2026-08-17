import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  saveCheckpoint,
  saveMidRunCheckpoint,
  pruneCheckpoints,
  listCheckpoints,
} from "../src/jobs/checkpoint.mjs";

describe("checkpoint prune", () => {
  let cfg;
  before(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-prune-"));
    cfg = { paths: { configDir: dir } };
  });

  it("never deletes running mid-run by default", async () => {
    await saveMidRunCheckpoint(cfg, {
      id: "job_run_1",
      goal: "g",
      workspace: "/tmp/w",
      turns: 2,
      maxTurns: 10,
    });
    await saveCheckpoint(cfg, {
      id: "job_old_1",
      goal: "g",
      workspace: "/tmp/w",
      status: "succeeded",
      pass: true,
      turns: 1,
      at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
    });
    // force age by rewriting at
    const fp = path.join(cfg.paths.configDir, "checkpoints", "job_old_1.json");
    const j = JSON.parse(await fs.readFile(fp, "utf8"));
    j.at = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    await fs.writeFile(fp, JSON.stringify(j));

    const pr = await pruneCheckpoints(cfg, {
      maxCount: 50,
      maxAgeMs: 7 * 24 * 3600 * 1000,
    });
    assert.ok(pr.removed >= 1);
    const list = await listCheckpoints(cfg, { limit: 50 });
    assert.ok(list.some((x) => x.id === "job_run_1"));
    assert.ok(!list.some((x) => x.id === "job_old_1"));
  });

  it("maxCount drops oldest terminal", async () => {
    for (let i = 0; i < 5; i++) {
      await saveCheckpoint(cfg, {
        id: `job_n_${i}`,
        goal: "g",
        status: "failed",
        pass: false,
        turns: 1,
      });
      const fp = path.join(cfg.paths.configDir, "checkpoints", `job_n_${i}.json`);
      const j = JSON.parse(await fs.readFile(fp, "utf8"));
      j.at = new Date(Date.now() - (5 - i) * 3600 * 1000).toISOString();
      await fs.writeFile(fp, JSON.stringify(j));
    }
    const pr = await pruneCheckpoints(cfg, { maxCount: 2, maxAgeMs: 0 });
    assert.ok(pr.removed >= 1);
    const list = await listCheckpoints(cfg, { limit: 50 });
    const ns = list.filter((x) => String(x.id).startsWith("job_n_"));
    assert.ok(ns.length <= 2);
  });

  it("dryRun does not delete", async () => {
    await saveCheckpoint(cfg, {
      id: "job_dry_1",
      goal: "g",
      status: "resumed",
      turns: 1,
    });
    const fp = path.join(cfg.paths.configDir, "checkpoints", "job_dry_1.json");
    const j = JSON.parse(await fs.readFile(fp, "utf8"));
    j.at = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();
    await fs.writeFile(fp, JSON.stringify(j));
    const pr = await pruneCheckpoints(cfg, {
      dryRun: true,
      maxAgeMs: 7 * 24 * 3600 * 1000,
    });
    assert.ok(pr.dryRun);
    await fs.access(fp); // still exists
  });
});
