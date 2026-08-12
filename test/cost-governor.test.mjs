import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  checkCostBudget,
  recordJobCost,
  getCostGovernorStatus,
  estimateUsdFromUsage,
} from "../src/tokens/cost-governor.mjs";

describe("cost governor", () => {
  it("allows under soft cap", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-cost-"));
    const cfg = {
      paths: { configDir: dir },
      cost: { dailySoftUsd: 1, dailyHardUsd: 2, perJobUsd: 1 },
    };
    const c = await checkCostBudget(cfg);
    assert.equal(c.ok, true);
    assert.equal(c.hard, false);
  });

  it("hard blocks after spend", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-cost2-"));
    const cfg = {
      paths: { configDir: dir },
      cost: { dailySoftUsd: 0.01, dailyHardUsd: 0.05, pauseQueueOnHard: true },
    };
    await recordJobCost(cfg, { usd: 0.06, jobId: "j1" });
    const c = await checkCostBudget(cfg);
    assert.equal(c.ok, false);
    assert.equal(c.hard, true);
    const st = await getCostGovernorStatus(cfg);
    assert.equal(st.paused, true);
  });

  it("estimates usd", () => {
    const usd = estimateUsdFromUsage(
      { prompt_tokens: 1000, completion_tokens: 100 },
      { agent: { model: "default" }, tokens: { rates: { default: { in: 1e-6, out: 2e-6 } } } }
    );
    assert.ok(usd > 0);
  });
});
