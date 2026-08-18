/**
 * Cost governor day rollover + status shape (doctor-facing).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  checkCostBudget,
  recordJobCost,
  getCostGovernorStatus,
} from "../src/tokens/cost-governor.mjs";

describe("cost governor day rollover", () => {
  let tmp;
  let cfg;

  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-cost-roll-"));
    cfg = {
      paths: { configDir: tmp },
      cost: { dailySoftUsd: 1, dailyHardUsd: 2, pauseQueueOnHard: true },
    };
  });

  after(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("resets spend when ledger day is stale", async () => {
    const ledgerPath = path.join(tmp, "cost-governor.json");
    await fs.writeFile(
      ledgerPath,
      JSON.stringify({
        day: "2000-01-01",
        spentUsd: 99,
        jobs: 50,
        paused: false,
        events: [{ at: "2000-01-01", usd: 99 }],
      })
    );
    const b = await checkCostBudget(cfg);
    assert.equal(b.ok, true, "stale day must not inherit old hard spend");
    assert.ok(b.spentUsd < 1, `expected reset spend, got ${b.spentUsd}`);
    const st = await getCostGovernorStatus(cfg);
    assert.ok(st.day);
    assert.notEqual(st.day, "2000-01-01");
    assert.equal(typeof st.ok, "boolean");
    assert.ok(st.limits);
    assert.equal(typeof st.limits.dailyHardUsd, "number");
  });

  it("status includes recent events after spend", async () => {
    await recordJobCost(cfg, { usd: 0.05, jobId: "roll-1", estimated: false });
    const st = await getCostGovernorStatus(cfg);
    assert.equal(st.ok, true);
    assert.ok(Array.isArray(st.events));
    assert.ok(st.spentUsd >= 0.05);
  });
});
