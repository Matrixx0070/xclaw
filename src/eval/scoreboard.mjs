/**
 * Autonomy scoreboard — KPI snapshot for release gates.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { listEvalHistory } from "./history.mjs";
import { summarizeEvalSpend } from "./spend.mjs";
import { readSkillLoopMetrics } from "../skills/loop.mjs";
import { getSoakSummary } from "./soak.mjs";
import { listQuarantined, filterQuarantinedResults } from "./quarantine.mjs";

async function readJson(p) {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {object} cfg
 * @param {{ root?: string }} [opts]
 */
export async function buildScoreboard(cfg, opts = {}) {
  const root = opts.root || process.cwd();
  const baseline = await readJson(path.join(root, "eval/baselines/main.json"));
  let trend = [];
  try {
    const raw = await fs.readFile(path.join(root, "eval/baselines/trend.jsonl"), "utf8");
    trend = raw
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .slice(-20);
  } catch {
    /* */
  }

  const history = await listEvalHistory(cfg, { limit: 20 }).catch(() => []);
  const spend = await summarizeEvalSpend(cfg, { limit: 50 }).catch(() => null);
  const skillMetrics = await readSkillLoopMetrics(cfg, 30).catch(() => []);
  const soak = await getSoakSummary(cfg).catch(() => null);

  const skillsHelped = skillMetrics.filter((m) => m.helped).length;


  const resultsAll = baseline?.results || [];
  const q = await filterQuarantinedResults(cfg, resultsAll).catch(() => ({
    kept: resultsAll,
    skipped: [],
  }));
  const results = q.kept;
  const quarantined = await listQuarantined(cfg).catch(() => []);

  const long = results.filter((r) => String(r.id || "").startsWith("long-"));
  const campaign = results.filter((r) => String(r.id || "").startsWith("campaign-"));
  const campaignBaseline = await readJson(path.join(root, "eval/baselines/campaign.json"));

  const hard = results.filter((r) => String(r.id || "").startsWith("hard-"));
  const passed = results.filter((r) => r.pass).length;
  const total = results.length || 0;
  const passRate = total ? passed / total : baseline?.passRate ?? null;

  // Heuristic hallucination proxy: grounding failures in history
  let groundFails = 0;
  let histRuns = 0;
  for (const h of history) {
    histRuns++;
    if ((h.passRate || 0) < 1) groundFails++;
  }

  const meanTurns =
    baseline?.meanTurns ??
    (total ? results.reduce((s, r) => s + (r.turns || 0), 0) / total : null);

  const scoreboard = {
    at: new Date().toISOString(),
    passRate,
    passed,
    total,
    meanTurns,
    meanWallMs: baseline?.meanWallMs ?? null,
    costUsd: baseline?.cost?.usd ?? spend?.totalUsd ?? null,
    tokens: baseline?.tokens?.total ?? spend?.totalTokens ?? null,
    hardPack: {
      total: hard.length,
      passed: hard.filter((r) => r.pass).length,
    },
    longPack: {
      total: long.length,
      passed: long.filter((r) => r.pass).length,
    },
    campaignPack: {
      total: campaign.length || campaignBaseline?.total || 0,
      passed:
        campaign.filter((r) => r.pass).length ||
        campaignBaseline?.passed ||
        0,
      passRate: campaignBaseline?.passRate ?? null,
    },
    skillLoop: {
      samples: skillMetrics.length,
      helped: skillsHelped,
      helpRate: skillMetrics.length ? skillsHelped / skillMetrics.length : null,
    },
    soak: soak
      ? {
          nights: soak.nights,
          runs: soak.runs,
          passRate: soak.passRate,
          flakes: soak.flakes,
          flakeBudgetOk: soak.flakeBudgetOk,
          gate: soak.gate,
        }
      : null,
    trend: trend.slice(-10),
    spendWindow: spend
      ? { runs: spend.runs, totalUsd: spend.totalUsd, avgUsdPerRun: spend.avgUsdPerRun }
      : null,
    historyRuns: histRuns,
    imperfectRuns: groundFails,
    quarantine: {
      count: quarantined.length,
      ids: quarantined.map((c) => c.id),
      excludedFromGate: (q.skipped || []).map((r) => r.id),
    },
    releaseGate: {
      minPassRate: 0.9,
      ok: passRate == null ? null : passRate >= 0.9,
      note: quarantined.length
        ? `excluded ${quarantined.length} quarantined case(s)`
        : null,
    },
  };
  return scoreboard;
}
