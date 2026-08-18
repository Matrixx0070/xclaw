#!/usr/bin/env node
/**
 * Flake budget CI gate.
 * Exit 0 ok, 1 fail, 2 live skipped (offline + budget ok).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateFlakeBudget,
  countFlakesFromAttempts,
} from "../src/eval/flake-budget.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args) {
  return spawnSync(cmd, args, { cwd: root, encoding: "utf8", env: process.env });
}

function log(m) {
  console.error(`[flake-budget-ci] ${m}`);
}

const offline = run(process.execPath, ["scripts/autonomy-harness-offline.mjs"]);
if (offline.status !== 0) {
  log(`autonomy offline failed exit=${offline.status}`);
  process.exit(offline.status ?? 1);
}
log("autonomy offline: pass");

let liveExit = 0;
const live = run(process.execPath, ["scripts/autonomy-harness-live.mjs"]);
liveExit = live.status ?? 1;
if (liveExit === 0) log("autonomy live: pass");
else if (liveExit === 2) log("autonomy live: skipped (no API key)");
else log(`autonomy live: fail exit=${liveExit}`);

let totalCases = 0;
let flakeCount = 0;
const soakSummary = path.join(
  process.env.HOME || "/tmp",
  ".xclaw",
  "soak",
  "summary.json"
);
if (fs.existsSync(soakSummary)) {
  try {
    const s = JSON.parse(fs.readFileSync(soakSummary, "utf8"));
    totalCases = Number(s.totalCases || s.cases || 0);
    flakeCount = Number(s.flakes || s.flakeCount || 0);
  } catch {
    /* */
  }
}

const attemptsPath = process.env.XCLAW_FLAKE_ATTEMPTS;
if (attemptsPath && fs.existsSync(attemptsPath)) {
  try {
    const rows = JSON.parse(fs.readFileSync(attemptsPath, "utf8"));
    const c = countFlakesFromAttempts(rows);
    totalCases = c.totalCases;
    flakeCount = c.flakeCount;
  } catch {
    /* */
  }
}

const verdict = evaluateFlakeBudget({ totalCases, flakeCount }, {});
log(
  `flake budget: ok=${verdict.ok} rate=${verdict.flakeRate} flakes=${verdict.flakeCount}/${verdict.totalCases}`
);
if (!verdict.ok) {
  log(verdict.reason);
  process.exit(1);
}

if (liveExit === 1) process.exit(1);
if (liveExit === 2) process.exit(2);
process.exit(0);
