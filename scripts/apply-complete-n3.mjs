#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const NEEDLES = [
  ["src/jobs/job.mjs", "ensureJobReceiptCollector"],
  ["bin/xclaw.mjs", "printStopHelp"],
  ["scripts/release-gate.mjs", "stopSurface"],
  ["scripts/release-gate.mjs", "land-batch-n3"],
  ["scripts/ci-ship-pack.mjs", "apply-complete-n3"],
  ["src/agent/loop.mjs", "guardToolAgainstHardCircuit"],
  ["src/cli/doctor.mjs", "attachStopSummaryWithSurface"],
  ["src/jobs/history.mjs", "mergeReceiptSnapshotIntoJob"],
  ["src/eval/stop-fire-drill.mjs", "fireDrillPostOffline"],
  ["src/gateway/stop-route.mjs", "dryRun"],
  ["src/jobs/checkpoint.mjs", "rehydrateReceiptFromCheckpoint"],
  ["src/tokens/cost-governor.mjs", "stampCostHardBlock"],
  ["src/eval/autonomy-smoke-compare.mjs", "compareStopChannel"],
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
console.error("[complete-n3] merge branch for full tree; needles:", needList().join(", ") || "none");
process.exit(needList().length ? 1 : 0);
