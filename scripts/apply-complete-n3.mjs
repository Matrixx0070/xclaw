#!/usr/bin/env node
/** Idempotent check for complete-n3 surface. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

const NEEDLES = [
  ["src/jobs/job.mjs", "ensureJobReceiptCollector"],
  ["bin/xclaw.mjs", "printStopHelp"],
  ["scripts/release-gate.mjs", "stopSurface"],
  ["scripts/release-gate.mjs", "land-batch-n3-check"],
  ["scripts/ci-ship-pack.mjs", "land-batch-n3"],
  ["src/agent/loop.mjs", "guardToolAgainstHardCircuit"],
  ["src/cli/doctor.mjs", "attachStopSummaryWithSurface"],
  ["src/jobs/history.mjs", "mergeReceiptSnapshotIntoJob"],
  ["src/eval/stop-fire-drill.mjs", "fireDrillPostOffline"],
  ["src/gateway/stop-route.mjs", "dryRun"],
];

function needList() {
  return NEEDLES.filter(([f, n]) => {
    const fp = path.join(root, f);
    return !(fs.existsSync(fp) && fs.readFileSync(fp, "utf8").includes(n));
  }).map(([f, n]) => `${f}::${n}`);
}

if (check) {
  if (!needList().length) {
    console.error("[complete-n3] check OK");
    process.exit(0);
  }
  console.error("[complete-n3] NEED", needList().join(", "));
  process.exit(1);
}

for (const rel of ["patches/complete-n3-all10.patch", "patches/land-batch-n3.patch"]) {
  const fp = path.join(root, rel);
  if (!fs.existsSync(fp)) continue;
  if (spawnSync("git", ["apply", "--check", fp], { cwd: root }).status === 0) {
    spawnSync("git", ["apply", "--whitespace=nowarn", fp], { cwd: root });
    console.error("[complete-n3] APPLIED", rel);
  }
}

if (needList().length) {
  console.error("[complete-n3] still NEED", needList().join(", "));
  process.exit(1);
}
console.error("[complete-n3] apply OK");
process.exit(0);
