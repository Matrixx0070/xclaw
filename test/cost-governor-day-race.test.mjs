/**
 * Concurrent day-boundary: stale ledger + parallel recordJobCost.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  recordJobCost,
  getCostGovernorStatus,
} from "../src/tokens/cost-governor.mjs";

describe("cost governor day-boundary race", () => {
  let tmp;
  let cfg;
  const ledgerFile = () => path.join(tmp, "cost-governor.json");

  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-cost-race-"));
    cfg = {
      paths: { configDir: tmp },
      cost: { dailySoftUsd: 5, dailyHardUsd: 10, pauseQueueOnHard: true },
    };
  });

  after(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  async function seedStale() {
    await fs.writeFile(
      ledgerFile(),
      JSON.stringify({
        day: "2000-01-01",
        spentUsd: 99,
        jobs: 50,
        paused: true,
        events: [{ at: "2000-01-01", usd: 99 }],
      })
    );
  }

  it("parallel record across stale day does not keep 99 spend", async () => {
    await seedStale();
    const N = 12;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        recordJobCost(cfg, { usd: 0.01, jobId: `race-${i}` })
      )
    );
    const st = await getCostGovernorStatus(cfg);
    assert.notEqual(st.day, "2000-01-01");
    assert.ok(st.spentUsd < 5, `expected reset+small spend, got ${st.spentUsd}`);
    assert.ok(st.spentUsd < 99);
  });

  it("parallel records after clean day sum exactly", async () => {
    await fs.writeFile(
      ledgerFile(),
      JSON.stringify({
        day: new Date().toISOString().slice(0, 10),
        spentUsd: 0,
        jobs: 0,
        paused: false,
        events: [],
      })
    );
    const N = 8;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        recordJobCost(cfg, { usd: 0.02, jobId: `acc-${i}` })
      )
    );
    const st = await getCostGovernorStatus(cfg);
    const expected = Math.round(N * 0.02 * 1e6) / 1e6;
    assert.ok(
      Math.abs(st.spentUsd - expected) < 0.0001,
      `expected ${expected}, got ${st.spentUsd}`
    );
    assert.equal(st.jobs, N);
  });
});
