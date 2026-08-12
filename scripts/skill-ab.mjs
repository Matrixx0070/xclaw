#!/usr/bin/env node
/**
 * Skill A/B harness (Phase L).
 * Usage:
 *   node scripts/skill-ab.mjs --id hard-fix-sum
 *   node scripts/skill-ab.mjs --tag recovery --limit 5
 */
import { loadConfig } from "../src/config/load.mjs";
import { runSkillAB, runSkillABBatch, readSkillLoopMetrics } from "../src/skills/loop.mjs";
import { ensureComputer } from "../src/computer/ensure.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const get = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : null;
};

const key =
  process.env.XCLAW_API_KEY || process.env.XAI_API_KEY || process.env.OPENAI_API_KEY;
if (!key) {
  console.error("Set XAI_API_KEY");
  process.exit(2);
}

const cfg = await loadConfig();
cfg.security = { ...cfg.security, autoApprove: true };
await ensureComputer(cfg, { root, attempts: 3 });

const id = get("--id");
const tag = get("--tag");
const limit = Number(get("--limit") || 5);

let out;
if (id) {
  out = await runSkillAB(cfg, id);
} else if (tag) {
  out = await runSkillABBatch(cfg, { tag, limit });
} else {
  console.error("Usage: skill-ab --id <caseId> | --tag <tag> [--limit N]");
  process.exit(1);
}

const metrics = await readSkillLoopMetrics(cfg, 20);
console.log(
  JSON.stringify(
    {
      result: out,
      recentHelpRate:
        metrics.filter((m) => m.helped).length / Math.max(1, metrics.length),
      samples: metrics.length,
    },
    null,
    2
  )
);

const helped = out.helpRate != null ? out.helpRate > 0 : out.delta?.helped;
process.exit(0);
