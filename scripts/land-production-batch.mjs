#!/usr/bin/env node
/**
 * Apply production wires that apply cleanly (idempotent via needles).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

export const PRODUCTION_BATCH = [
  {
    file: "patches/loop-cost-auth-refresh.patch",
    target: "src/agent/loop.mjs",
    needles: ["checkLoopCostBudget", "loop-cost-check.mjs"],
  },
  {
    file: "patches/checkpoint-hash-verify-wire.patch",
    target: "src/jobs/checkpoint.mjs",
    needles: ["verifyCheckpointToolHash"],
  },
  {
    file: "patches/gateway-land-wires.patch",
    target: "src/gateway/index.mjs",
    needles: ["createLiveStreamWriter", "ensureApprovalDigestCronJob"],
  },
  {
    file: "patches/job-dual-preflight.patch",
    target: "src/jobs/job.mjs",
    needles: ["preflightJobBudgets", "budgetBlockedJob"],
  },
  {
    file: "patches/release-gate-strict-extras.patch",
    target: "scripts/release-gate.mjs",
    needles: ["listStrictExtraTests", "strict-extras"],
  },
  // doctor-receipt-metrics.patch wired the probe inline into doctor.mjs before
  // doctor-ops-bundle.mjs existed; batch-4's doctor-ops-bundle.patch superseded
  // it, and 3.288.0 removed the inline duplicate it had left behind. The wire
  // now lives in the bundle — see test/doctor-no-duplicate-probes.test.mjs.
];

function applied(e) {
  const t = fs.readFileSync(path.join(root, e.target), "utf8");
  return e.needles.every((n) => t.includes(n));
}

let need = 0;
let appliedN = 0;
for (const e of PRODUCTION_BATCH) {
  if (applied(e)) {
    console.error(`[land-prod] OK ${e.file}`);
    appliedN += 1;
    continue;
  }
  if (check) {
    console.error(`[land-prod] NEED ${e.file}`);
    need += 1;
    continue;
  }
  const r = spawnSync("git", ["apply", "--whitespace=nowarn", path.join(root, e.file)], {
    cwd: root,
    encoding: "utf8",
  });
  if (r.status === 0 || applied(e)) {
    console.error(`[land-prod] APPLIED ${e.file}`);
    appliedN += 1;
  } else {
    console.error(`[land-prod] FAIL ${e.file}: ${(r.stderr || "").slice(0, 240)}`);
    process.exit(1);
  }
}
if (check && need) process.exit(1);
console.error(`[land-prod] done applied=${appliedN} need=${need}`);
process.exit(0);
