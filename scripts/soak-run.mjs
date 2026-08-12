#!/usr/bin/env node
/**
 * One soak iteration: readiness → tags → ledger + optional flake lines.
 * Schedule nightly for 72h (3+ nights). Env: SOAK_TAGS=campaign,smoke
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/load.mjs";
import { ensureComputer } from "../src/computer/ensure.mjs";
import { runEvalSuite } from "../src/eval/runner.mjs";
import { checkReadiness } from "../src/gateway/readiness.mjs";
import {
  appendSoakRun,
  appendFlake,
  getSoakSummary,
} from "../src/eval/soak.mjs";
import { buildScoreboard } from "../src/eval/scoreboard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const key =
  process.env.XCLAW_API_KEY || process.env.XAI_API_KEY || process.env.OPENAI_API_KEY;

if (!key) {
  console.error("Set XAI_API_KEY for soak");
  process.exit(2);
}

const tags = (process.env.SOAK_TAGS || "smoke,campaign").split(",").map((s) => s.trim());
const cfg = await loadConfig();
cfg.security = { ...cfg.security, autoApprove: true };

await ensureComputer(cfg, { root, attempts: 3 });
const ready = await checkReadiness(cfg);
if (!ready.ready) {
  console.error("[soak] not ready", ready.body?.checks);
}

let passed = 0;
let failed = 0;
let total = 0;
const caseResults = [];

for (const tag of tags) {
  const report = await runEvalSuite({ cfg, tag });
  passed += report.passed || 0;
  failed += report.failed || 0;
  total += report.total || 0;
  for (const r of report.results || []) {
    caseResults.push(r);
    if (!r.pass) {
      await appendFlake(cfg, {
        caseId: r.id,
        tag,
        failures: r.failures || [],
        turns: r.turns,
      });
    }
  }
}

const run = await appendSoakRun(cfg, {
  tags,
  passed,
  failed,
  total,
  passRate: total ? passed / total : 0,
  results: caseResults.map((r) => ({ id: r.id, pass: r.pass, turns: r.turns })),
});

const summary = await getSoakSummary(cfg);
const sb = await buildScoreboard(cfg, { root });

console.log(
  JSON.stringify(
    {
      run,
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

process.exit(failed > 0 ? 1 : 0);
