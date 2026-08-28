/**
 * Checkpoint eviction must run from the daily maintenance pass.
 *
 * pruneCheckpoints has existed, with tests and a documented policy
 * (maxCount 100 / 14d), since the checkpoint store was added. It was
 * reachable from exactly one production path: runEvolutionTick, called only
 * from src/cron/heartbeat.mjs. A host with no heartbeat cron job never runs
 * an evolution tick, so it never evicts a checkpoint — and src/ops/maintenance.mjs,
 * whose stated job is bounding growth, named checkpoints in neither its
 * targets nor its "Not handled here" exemptions.
 *
 * Measured live at 3.316.0: cron.jobs = 0, and ~/.xclaw/checkpoints held 205
 * files of which 204 were evictable (122 succeeded, 69 failed, 13
 * budget_exceeded, 1 running) against a maxCount of 100. A policy that
 * cannot be exceeded had been exceeded twofold, which is only possible if it
 * had never once been applied.
 *
 * The heartbeat path is also gated behind inQuietHours() and canSpend() early
 * returns, so even a configured heartbeat skips disk housekeeping whenever the
 * LLM budget is spent. Wiring the daily pass makes eviction independent of
 * both, and leaves the heartbeat call as a harmless idempotent extra.
 *
 * Second defect covered here: the doctor's checkpoints.store row reported
 * `listed=${list.length}` from listCheckpoints(cfg, {limit: 50}) — so a
 * directory of 205 printed "listed=50", and would print "listed=50" at 5000.
 * The number reported was the cap, not the population.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { saveCheckpoint, listCheckpoints, countCheckpoints } from "../src/jobs/checkpoint.mjs";
import { runOpsMaintenance } from "../src/ops/maintenance.mjs";

const dirs = [];
afterEach(async () => {
  while (dirs.length) await fs.rm(dirs.pop(), { recursive: true, force: true });
});

async function tmpCfg(tag) {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), `xclaw-opsck-${tag}-`));
  dirs.push(d);
  return { paths: { configDir: d } };
}

/** n terminal checkpoints, newest first by `at`. */
async function seed(cfg, n, status = "succeeded") {
  for (let i = 0; i < n; i += 1) {
    await saveCheckpoint(cfg, {
      id: `job_${status}_${String(i).padStart(4, "0")}`,
      goal: "g",
      workspace: "/tmp/w",
      status,
      turns: 1,
      at: new Date(Date.now() - i * 60_000).toISOString(),
    });
  }
}

/** Maintenance with the JSONL half and the proofs half both inert. */
async function maintenance(cfg, extra = {}) {
  const mitm = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-opsck-mitm-"));
  dirs.push(mitm);
  const prev = process.env.XCLAW_MITM_CONFDIR;
  process.env.XCLAW_MITM_CONFDIR = mitm;
  try {
    return await runOpsMaintenance({
      ...cfg,
      ...extra,
      ops: { maintenance: { maxBytes: 2 ** 40 } },
    });
  } finally {
    if (prev === undefined) delete process.env.XCLAW_MITM_CONFDIR;
    else process.env.XCLAW_MITM_CONFDIR = prev;
  }
}

describe("ops maintenance: checkpoint eviction", () => {
  it("THE REGRESSION: the daily pass evicts, with no heartbeat in the picture", async () => {
    const cfg = await tmpCfg("evict");
    await seed(cfg, 130);
    const r = await maintenance(cfg);
    assert.ok(r.checkpoints, "maintenance must report a checkpoints result");
    assert.equal(r.checkpoints.removed, 30, "130 evictable against maxCount 100");
    assert.equal((await countCheckpoints(cfg)).total, 100);
  });

  it("never evicts a running checkpoint, however far down the sort it sits", async () => {
    const cfg = await tmpCfg("protect");
    await saveCheckpoint(cfg, {
      id: "job_running_oldest",
      goal: "g",
      workspace: "/tmp/w",
      status: "running",
      turns: 1,
      at: new Date(Date.now() - 999 * 60_000).toISOString(),
    });
    await seed(cfg, 130);
    await maintenance(cfg);
    const ids = (await listCheckpoints(cfg, { limit: 500 })).map((c) => c.id);
    assert.ok(ids.includes("job_running_oldest"));
  });

  it("honours cfg.checkpoints.maxCount rather than a second private default", async () => {
    const cfg = await tmpCfg("cfgmax");
    await seed(cfg, 40);
    const r = await maintenance(cfg, { checkpoints: { maxCount: 10 } });
    assert.equal(r.checkpoints.removed, 30);
    assert.equal((await countCheckpoints(cfg)).total, 10);
  });

  it("an empty store is reported, not an error", async () => {
    const cfg = await tmpCfg("empty");
    const r = await maintenance(cfg);
    assert.equal(r.checkpoints.removed, 0);
    assert.deepEqual(r.errors, []);
  });
});

describe("doctor checkpoints.store row", () => {
  /**
   * The row is written inline in runDoctor, which calls loadConfig() itself, so
   * it cannot be driven from a test against a temp store. What CAN be pinned is
   * the invariant that made it wrong: the row must not derive its population
   * from a capped listing. Reverting it to listCheckpoints turns this red.
   */
  it("THE REGRESSION: counts the store rather than sampling 50 of it", async () => {
    const src = await fs.readFile(new URL("../src/cli/doctor.mjs", import.meta.url), "utf8");
    const i = src.indexOf('"checkpoints.store"');
    assert.ok(i > 0, "checkpoints.store row must exist");
    // Window: the checkpoint-store import that feeds the row, through the row.
    const start = src.lastIndexOf("jobs/checkpoint.mjs", i);
    assert.ok(start > 0 && i - start < 1000, "row must be fed by a nearby checkpoint import");
    const block = src.slice(start, i + 400);
    assert.match(block, /countCheckpoints/);
    assert.doesNotMatch(block, /listCheckpoints/);
    assert.doesNotMatch(block, /listed=/);
  });
});

describe("countCheckpoints", () => {
  it("THE REGRESSION: reports the population, not the listing cap", async () => {
    const cfg = await tmpCfg("count");
    await seed(cfg, 60);
    // What the doctor row used to print, and what is actually on disk.
    assert.equal((await listCheckpoints(cfg, { limit: 50 })).length, 50);
    assert.equal((await countCheckpoints(cfg)).total, 60);
  });

  it("breaks the population down by status", async () => {
    const cfg = await tmpCfg("hist");
    await seed(cfg, 3, "succeeded");
    await seed(cfg, 2, "failed");
    await saveCheckpoint(cfg, {
      id: "job_r",
      goal: "g",
      workspace: "/tmp/w",
      status: "running",
      turns: 1,
    });
    const c = await countCheckpoints(cfg);
    assert.equal(c.total, 6);
    assert.equal(c.byStatus.succeeded, 3);
    assert.equal(c.byStatus.failed, 2);
    assert.equal(c.byStatus.running, 1);
  });

  it("an absent store counts zero instead of throwing", async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-opsck-absent-"));
    dirs.push(d);
    const c = await countCheckpoints({ paths: { configDir: d } });
    assert.equal(c.total, 0);
    assert.deepEqual(c.byStatus, {});
  });
});
