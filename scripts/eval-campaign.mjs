#!/usr/bin/env node
/**
 * Multi-hour / campaign eval runner (Phase H).
 * Runs --tag campaign (and optional long) with readiness, writes campaign baseline.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { loadConfig } from "../src/config/load.mjs";
import { ensureComputer } from "../src/computer/ensure.mjs";
import { runEvalSuite } from "../src/eval/runner.mjs";
import { checkReadiness } from "../src/gateway/readiness.mjs";
import { buildScoreboard } from "../src/eval/scoreboard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const key =
  process.env.XCLAW_API_KEY || process.env.XAI_API_KEY || process.env.OPENAI_API_KEY;

if (!key) {
  console.error("Set XAI_API_KEY for campaign eval");
  process.exit(2);
}

const tags = (process.env.EVAL_TAGS || "campaign").split(",").map((s) => s.trim());
const cfg = await loadConfig();
cfg.security = { ...cfg.security, autoApprove: true };

await ensureComputer(cfg, { root, attempts: 3 });
const ready = await checkReadiness(cfg);
if (!ready.ready) {
  console.error("[campaign] not ready", ready.body?.checks);
  await ensureComputer(cfg, { root, attempts: 2 });
}

const allResults = [];
for (const tag of tags) {
  console.error(`[campaign] tag=${tag}`);
  const report = await runEvalSuite({ cfg, tag });
  allResults.push(report);
  console.error(
    `[campaign] ${tag} passRate=${((report.passRate || 0) * 100).toFixed(1)}%`
  );
}

const merged = {
  at: new Date().toISOString(),
  tags,
  reports: allResults,
  passRate:
    allResults.reduce((s, r) => s + (r.passed || 0), 0) /
    Math.max(1, allResults.reduce((s, r) => s + (r.total || 0), 0)),
  passed: allResults.reduce((s, r) => s + (r.passed || 0), 0),
  total: allResults.reduce((s, r) => s + (r.total || 0), 0),
};

const out = path.join(root, "eval/baselines/campaign.json");
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, JSON.stringify(merged, null, 2) + "\n");
console.error(`[campaign] wrote ${out}`);

const sb = await buildScoreboard(cfg, { root });
console.error(
  `[campaign] scoreboard gate=${sb.releaseGate?.ok} passRate=${sb.passRate}`
);

process.exit(merged.passRate < 1 ? 1 : 0);
