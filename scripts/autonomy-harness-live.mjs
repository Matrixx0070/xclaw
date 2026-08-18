#!/usr/bin/env node
/**
 * Live autonomy harness — gated on XAI_API_KEY / XCLAW_API_KEY.
 * Runs tag=autonomy (a4-*) via runAutonomyEval.
 *
 * Usage:
 *   XAI_API_KEY=... node scripts/autonomy-harness-live.mjs
 *   node scripts/autonomy-harness-live.mjs --id a4-G01-write-read
 *
 * Exit 0 on pass rate threshold; 2 if no API key (skipped intentionally).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function hasLiveKey() {
  return Boolean(
    process.env.XAI_API_KEY ||
      process.env.XCLAW_API_KEY ||
      process.env.GROK_API_KEY
  );
}

if (!hasLiveKey()) {
  console.error(
    "[autonomy-live] SKIP: no XAI_API_KEY / XCLAW_API_KEY — offline harness only"
  );
  process.exit(2);
}

const idArg = process.argv.includes("--id")
  ? process.argv[process.argv.indexOf("--id") + 1]
  : null;
const trials = process.argv.includes("--trials")
  ? Number(process.argv[process.argv.indexOf("--trials") + 1]) || 1
  : 1;

const { runAutonomyEval } = await import("../src/eval/autonomy-runner.mjs");

const cfg = {
  profile: process.env.XCLAW_PROFILE || "lab",
  agent: {
    provider: "xai",
    model: process.env.XCLAW_MODEL || process.env.GROK_MODEL || "grok-2-latest",
    apiKey:
      process.env.XAI_API_KEY ||
      process.env.XCLAW_API_KEY ||
      process.env.GROK_API_KEY,
    maxTurns: Number(process.env.XCLAW_MAX_TURNS) || 12,
  },
  security: { autoApprove: true },
  paths: { configDir: path.join(root, ".xclaw-eval") },
};

console.error(
  `[autonomy-live] running tag=autonomy${idArg ? ` id=${idArg}` : ""} trials=${trials}`
);

const report = await runAutonomyEval({
  cfg,
  tag: "autonomy",
  id: idArg || undefined,
  trials,
  channel: "cli",
  onEvent: (e) => {
    if (e.phase === "case_start" || e.phase === "case_end") {
      console.error(`[autonomy-live] ${e.phase} ${e.id || ""} trial=${e.trial || ""}`);
    }
  },
});

const passRate = report?.aggregate?.passRate ?? report?.passRate ?? 0;
const total = report?.results?.length ?? report?.total ?? 0;
console.error(`[autonomy-live] done total=${total} passRate=${passRate}`);

const minRate = Number(process.env.XCLAW_AUTONOMY_MIN_PASS) || 0.5;
if (total === 0) {
  console.error("[autonomy-live] no cases run");
  process.exit(1);
}
if (passRate < minRate) {
  console.error(`[autonomy-live] FAIL passRate ${passRate} < ${minRate}`);
  process.exit(1);
}
console.error("[autonomy-live] OK");
process.exit(0);
