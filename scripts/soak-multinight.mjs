#!/usr/bin/env node
/**
 * Phase N — multi-night soak execution.
 * Modes:
 *   LIVE=1 SOAK_TAGS=smoke,campaign node scripts/soak-multinight.mjs
 *     runs soak once and stamps 3 nights by replaying ledger (night1 live + seed prior)
 *   SEED_ONLY=1 — seed 3 green nights for lab gate testing without API
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/load.mjs";
import { ensureComputer } from "../src/computer/ensure.mjs";
import { runEvalSuite } from "../src/eval/runner.mjs";
import {
  appendSoakRun,
  appendFlake,
  getSoakSummary,
  seedMultiNightSoak,
  rebuildSoakSummary,
} from "../src/eval/soak.mjs";
import { buildScoreboard } from "../src/eval/scoreboard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfg = await loadConfig();
cfg.security = { ...cfg.security, autoApprove: true };

const nights = Number(process.env.SOAK_NIGHTS || 3);

if (process.env.SEED_ONLY === "1") {
  const out = await seedMultiNightSoak(cfg, nights);
  console.log(JSON.stringify({ mode: "seed", ...out.summary }, null, 2));
  process.exit(out.summary.gate?.nightsOk ? 0 : 1);
}

const key =
  process.env.XCLAW_API_KEY || process.env.XAI_API_KEY || process.env.OPENAI_API_KEY;
if (!key) {
  console.error("Set XAI_API_KEY or SEED_ONLY=1");
  process.exit(2);
}

await ensureComputer(cfg, { root, attempts: 3 });
const tags = (process.env.SOAK_TAGS || "smoke").split(",").map((s) => s.trim());

let passed = 0,
  failed = 0,
  total = 0;
const caseResults = [];

for (const tag of tags) {
  const report = await runEvalSuite({ cfg, tag });
  passed += report.passed || 0;
  failed += report.failed || 0;
  total += report.total || 0;
  for (const r of report.results || []) {
    caseResults.push(r);
    if (!r.pass) {
      await appendFlake(cfg, { caseId: r.id, tag, failures: r.failures || [] });
    }
  }
}

const payload = {
  tags,
  passed,
  failed,
  total,
  passRate: total ? passed / total : 0,
  results: caseResults.map((r) => ({ id: r.id, pass: r.pass, turns: r.turns })),
};

// HONEST soak: only record this live run. Prior "nights" must be real runs over calendar days.
// (Removed synthetic backdating — design review Phase 0 / Claude Code report.)
await appendSoakRun(cfg, {
  ...payload,
  at: new Date().toISOString(),
  synthetic: false,
});

const summary = await rebuildSoakSummary(cfg);
const sb = await buildScoreboard(cfg, { root });

console.log(
  JSON.stringify(
    {
      live: payload,
      summary: {
        nights: summary.nights,
        runs: summary.runs,
        passRate: summary.passRate,
        flakes: summary.flakes,
        flakeBudgetOk: summary.flakeBudgetOk,
        gate: summary.gate,
      },
      scoreboardGate: sb.releaseGate,
    },
    null,
    2
  )
);

process.exit(summary.gate?.nightsOk && failed === 0 ? 0 : 1);
