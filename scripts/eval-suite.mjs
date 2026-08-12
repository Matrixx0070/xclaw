#!/usr/bin/env node
/**
 * Run the full autonomy suite (all cases) and write baseline.
 * Usage: node scripts/eval-suite.mjs
 * Requires XAI_API_KEY or OPENAI_API_KEY.
 */
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/load.mjs";
import { runEvalSuite, formatEvalReport } from "../src/eval/runner.mjs";
import { ensureComputer } from "../src/computer/ensure.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const key =
  process.env.XCLAW_API_KEY ||
  process.env.XAI_API_KEY ||
  process.env.OPENAI_API_KEY;

if (!key) {
  console.error("Set XAI_API_KEY or OPENAI_API_KEY");
  process.exit(2);
}

const cfg = await loadConfig();
cfg.security = { ...cfg.security, autoApprove: true };

await ensureComputer(cfg, { root, attempts: 3 });

// Brief readiness gate
const { checkReadiness } = await import("../src/gateway/readiness.mjs");
const ready = await checkReadiness(cfg);
if (!ready.ready) {
  console.error("[suite] not ready:", JSON.stringify(ready.body?.checks));
  // still try ensure once more
  await ensureComputer(cfg, { root, attempts: 2 });
}

const report = await runEvalSuite({ cfg });
console.log(formatEvalReport(report));
console.error(
  `[suite] passRate=${(report.passRate * 100).toFixed(1)}% tokens=${report.tokens?.total ?? 0}`
);

const out = path.join(root, "eval", "baselines", "main.json");
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, JSON.stringify(report, null, 2) + "\n");
console.error(`[suite] wrote ${out}`);

// Append trend line for Phase A tracking
try {
  const trendPath = path.join(root, "eval", "baselines", "trend.jsonl");
  const line = JSON.stringify({
    at: report.at,
    passRate: report.passRate,
    passed: report.passed,
    total: report.total,
    meanTurns: report.meanTurns,
    tokens: report.tokens?.total ?? null,
    costUsd: report.cost?.usd ?? null,
  });
  await fs.appendFile(trendPath, line + "\n");
  console.error(`[suite] trend → ${trendPath}`);
} catch (e) {
  console.error("[suite] trend write:", e.message);
}

process.exit(report.failed > 0 ? 1 : 0);
