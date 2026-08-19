#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const NEEDLES = [
  ["src/jobs/job.mjs", "stampCostHardBlock"],
  ["src/jobs/checkpoint.mjs", "rehydrateReceiptFromCheckpoint"],
  ["src/jobs/history.mjs", "costBlocked"],
  ["src/eval/stop-fire-drill.mjs", "fireDrillPostOffline"],
  ["src/cli/doctor.mjs", "attachStopSummaryWithSurface"],
  ["scripts/release-gate.mjs", "stopSurface.json"],
  ["docs/openapi-stop.yaml", "x-dry-run-response"],
  ["src/eval/autonomy-smoke-artifact.mjs", "lastDrain"],
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
console.error("[complete-n3]", needList().join(", ") || "OK");
process.exit(needList().length ? 1 : 0);
