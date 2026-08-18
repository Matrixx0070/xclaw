#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const NEEDLES = [
  ["src/jobs/job.mjs", "ensureJobReceiptCollector"],
  ["src/jobs/job.mjs", "job: { id, receiptCollector }"],
  ["bin/xclaw.mjs", "printStopHelp"],
  ["scripts/release-gate.mjs", "land-batch-n1-check"],
  ["scripts/release-gate.mjs", "stopSurface"],
  ["scripts/ci-ship-pack.mjs", "land-batch-n1"],
  ["src/cli/stop-sign.mjs", "GATEWAY_OFFLINE"],
  ["src/agent/loop.mjs", "guardToolAgainstHardCircuit"],
];
const PATCHES = ["patches/land-batch-n3.patch", "patches/quota-hard-circuit-loop.patch"];

function needList() {
  return NEEDLES.filter(([f, n]) => {
    const fp = path.join(root, f);
    return !(fs.existsSync(fp) && fs.readFileSync(fp, "utf8").includes(n));
  }).map(([f, n]) => `${f}::${n}`);
}

if (check) {
  if (!needList().length) {
    console.error("[land-n3] check OK");
    process.exit(0);
  }
  console.error("[land-n3] NEED", needList().join(", "));
  process.exit(1);
}
if (!needList().length) {
  console.error("[land-n3] already applied");
  process.exit(0);
}
for (const rel of PATCHES) {
  const fp = path.join(root, rel);
  if (!fs.existsSync(fp)) continue;
  if (spawnSync("git", ["apply", "--check", fp], { cwd: root }).status !== 0) continue;
  if (spawnSync("git", ["apply", "--whitespace=nowarn", fp], { cwd: root }).status === 0) {
    console.error(`[land-n3] APPLIED ${rel}`);
  }
}
if (needList().length) {
  console.error("[land-n3] still NEED", needList().join(", "));
  process.exit(1);
}
console.error("[land-n3] apply OK");
process.exit(0);
