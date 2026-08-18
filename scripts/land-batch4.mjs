#!/usr/bin/env node
/**
 * Apply batch-4 wires after land-batch3 (idempotent needles).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

export const BATCH4 = [
  {
    file: "patches/doctor-ops-bundle.patch",
    target: "src/cli/doctor.mjs",
    needles: ["pushDoctorOpsBundle"],
  },
  {
    file: "patches/gateway-stop-route.patch",
    target: "src/gateway/index.mjs",
    needles: ["tryHandleStopRoute"],
  },
  {
    file: "patches/release-gate-land-batch3.patch",
    target: "scripts/release-gate.mjs",
    needles: ["land-batch3-check"],
  },
  {
    file: "patches/checkpoint-restore-receipt.patch",
    target: "src/jobs/checkpoint.mjs",
    needles: ["receiptFromCheckpoint"],
  },
];

function applied(e) {
  const t = fs.readFileSync(path.join(root, e.target), "utf8");
  return e.needles.every((n) => t.includes(n));
}

let need = 0;
let appliedN = 0;
for (const e of BATCH4) {
  if (applied(e)) {
    console.error(`[land-batch4] OK ${e.file}`);
    appliedN += 1;
    continue;
  }
  if (check) {
    console.error(`[land-batch4] NEED ${e.file}`);
    need += 1;
    continue;
  }
  const r = spawnSync("git", ["apply", "--whitespace=nowarn", path.join(root, e.file)], {
    cwd: root,
    encoding: "utf8",
  });
  if (r.status === 0 || applied(e)) {
    console.error(`[land-batch4] APPLIED ${e.file}`);
    appliedN += 1;
  } else {
    console.error(`[land-batch4] FAIL ${e.file}: ${(r.stderr || "").slice(0, 240)}`);
    process.exit(1);
  }
}
if (check && need) process.exit(1);
console.error(`[land-batch4] done applied=${appliedN} need=${need}`);
process.exit(0);
