/**
 * Feature 3 — cost governor hard stop codes
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  checkCostBudget,
  checkJobCostBudget,
  recordJobCost,
  getCostGovernorStatus,
  setCostGovernorPaused,
} from "../src/tokens/cost-governor.mjs";

describe("cost-governor", () => {
  let dir;
  let cfg;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-cost-"));
    cfg = {
      paths: { configDir: dir },
      cost: { dailySoftUsd: 0.5, dailyHardUsd: 1.0, perJobUsd: 0.25 },
    };
  });

  it("ok under soft cap", async () => {
    const r = await checkCostBudget(cfg);
    assert.equal(r.ok, true);
    assert.equal(r.hard, false);
  });

  it("hard stop with BUDGET_EXCEEDED", async () => {
    await recordJobCost(cfg, { usd: 1.5, jobId: "j1" });
    const r = await checkCostBudget(cfg);
    assert.equal(r.ok, false);
    assert.equal(r.code, "BUDGET_EXCEEDED");
    assert.equal(r.scope, "day");
    assert.ok(r.spentUsd >= 1.5);
  });

  it("per-job gate", () => {
    const ok = checkJobCostBudget(cfg, 0.1);
    assert.equal(ok.ok, true);
    const bad = checkJobCostBudget(cfg, 0.3);
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "BUDGET_EXCEEDED");
    assert.equal(bad.scope, "job");
  });

  it("autonomy.maxUsdPerDay maps to hard", async () => {
    const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-cost2-"));
    const c = {
      paths: { configDir: dir2 },
      autonomy: { maxUsdPerDay: 0.01 },
    };
    await recordJobCost(c, { usd: 0.05 });
    const r = await checkCostBudget(c);
    assert.equal(r.ok, false);
    assert.equal(r.code, "BUDGET_EXCEEDED");
  });

  it("status + unpause", async () => {
    const st = await getCostGovernorStatus(cfg);
    assert.ok(st.day);
    await setCostGovernorPaused(cfg, false);
  });
});
