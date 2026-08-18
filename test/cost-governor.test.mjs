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
  governorMode,
  estimateUsdFromUsage,
  getCostGovernorStatus,
  setCostGovernorPaused,
  LONG_CONTEXT_PROMPT_TOKENS,
} from "../src/tokens/cost-governor.mjs";
import { getModelMeta } from "../src/providers/registry.mjs";

describe("cost governor", () => {
  let tmp;
  let cfg;

  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-cost-"));
    cfg = {
      paths: { configDir: tmp },
      cost: {
        dailySoftUsd: 1,
        dailyHardUsd: 3,
        economyAtUsd: 1,
        pauseQueueOnHard: true,
      },
    };
  });

  after(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("starts normal under soft cap", async () => {
    const m = await governorMode(cfg);
    assert.equal(m.mode, "normal");
    const b = await checkCostBudget(cfg);
    assert.equal(b.ok, true);
    assert.equal(b.soft, false);
  });

  it("enters economy after soft spend", async () => {
    await recordJobCost(cfg, { usd: 1.2, jobId: "j1", estimated: true });
    const m = await governorMode(cfg);
    assert.equal(m.mode, "economy");
  });

  it("tracks estimated vs billed separately", async () => {
    await recordJobCost(cfg, { usd: 0.1, jobId: "bill", estimated: false });
    const raw = JSON.parse(
      await fs.readFile(path.join(tmp, "cost-governor.json"), "utf8")
    );
    assert.ok((raw.spentBilledUsd || 0) >= 0.1);
    assert.ok((raw.spentEstimatedUsd || 0) >= 1.2);
  });

  it("halts at hard cap", async () => {
    await recordJobCost(cfg, { usd: 5, jobId: "j2", estimated: false });
    const b = await checkCostBudget(cfg);
    assert.equal(b.ok, false);
    assert.equal(b.hard, true);
    const m = await governorMode(cfg);
    assert.equal(m.mode, "halt");
  });

  it("setCostGovernorPaused works", async () => {
    await setCostGovernorPaused(cfg, false);
    const raw = JSON.parse(
      await fs.readFile(path.join(tmp, "cost-governor.json"), "utf8")
    );
    assert.equal(raw.paused, false);
  });
});

describe("estimateUsdFromUsage xAI tiers", () => {
  it("prices grok-4.3 short context", () => {
    const usd = estimateUsdFromUsage(
      { prompt_tokens: 100_000, completion_tokens: 100_000 },
      {},
      { modelRef: "xai/grok-4.3" }
    );
    // 100k * 1.25e-6 + 100k * 2.5e-6 = 0.125 + 0.25 = 0.375
    assert.ok(Math.abs(usd - 0.375) < 0.01, `got ${usd}`);
  });

  it("prices grok-4.3 long context full million", () => {
    const usd = estimateUsdFromUsage(
      { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 },
      {},
      { modelRef: "xai/grok-4.3" }
    );
    // long: 2.5 + 5.0 = 7.5
    assert.ok(Math.abs(usd - 7.5) < 0.01, `got ${usd}`);
  });

  it("doubles at long-context threshold for grok-4.3", () => {
    const usd = estimateUsdFromUsage(
      { prompt_tokens: LONG_CONTEXT_PROMPT_TOKENS, completion_tokens: 0 },
      {},
      { modelRef: "xai/grok-4.3" }
    );
    assert.ok(Math.abs(usd - 0.5) < 0.01, `got ${usd}`);
  });

  it("getModelMeta prefers grok-4.5 over grok-4", () => {
    const meta = getModelMeta({}, "xai/grok-4.5");
    assert.ok(Math.abs(meta.cost.in - 2e-6) < 1e-12);
    assert.ok(Math.abs(meta.cost.out - 6e-6) < 1e-12);
  });

  it("getModelMeta matches grok-build", () => {
    const meta = getModelMeta({}, "xai/grok-build-0.1");
    assert.ok(Math.abs(meta.cost.in - 1e-6) < 1e-12);
  });
});

// —— Feature 3 (3.78.0 line): hard-stop codes / per-job gate / autonomy cap ——
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
