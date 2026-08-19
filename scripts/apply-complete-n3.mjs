#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const NEEDLES = [
  ["src/gateway/stop-route.mjs", "dryRun"],
  ["src/jobs/history.mjs", "mergeReceiptSnapshotIntoJob"],
  ["src/eval/autonomy-smoke-compare.mjs", "compareStopChannel"],
  ["src/tokens/cost-hard-block.mjs", "stampCostHardBlock"],
  ["src/jobs/checkpoint-receipt.mjs", "rehydrateReceiptFromCheckpoint"],
  ["scripts/apply-complete-n3.mjs", "compareStopChannel"],
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
console.error("[complete-n3] needles:", needList().join(", ") || "none");
process.exit(needList().length ? 1 : 0);
