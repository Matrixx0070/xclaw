#!/usr/bin/env node
/**
 * Apply batch-3 production wires in dependency order (idempotent needles).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

export const BATCH3 = [
  {
    file: "patches/loop-cost-auth-refresh.patch",
    target: "src/agent/loop.mjs",
    needles: ["checkLoopCostBudget"],
  },
  {
    file: "patches/job-dual-preflight.patch",
    target: "src/jobs/job.mjs",
    needles: ["preflightJobBudgets"],
  },
  {
    file: "patches/job-receipt-collector.patch",
    target: "src/jobs/job.mjs",
    needles: ["receiptCollector"],
  },
  {
    file: "patches/loop-authorize-job.patch",
    target: "src/agent/loop.mjs",
    needles: ["options.job || options.receiptCollector"],
  },
  {
    file: "patches/job-mid-quota-escalate.patch",
    target: "src/jobs/job.mjs",
    needles: ["receiptCollector.quotaEscalate"],
  },
  {
    file: "patches/checkpoint-hash-verify-wire.patch",
    target: "src/jobs/checkpoint.mjs",
    needles: ["verifyCheckpointToolHash"],
  },
  {
    file: "patches/checkpoint-require-tip-delta.patch",
    target: "src/jobs/checkpoint.mjs",
    needles: ["shouldRequireToolHashTip"],
  },
  {
    file: "patches/checkpoint-quota-escalate.patch",
    target: "src/jobs/checkpoint.mjs",
    needles: ["quotaEscalate: job.quotaEscalate"],
  },
  {
    file: "patches/tls-stop-proxy.patch",
    target: "src/gateway/tls.mjs",
    needles: ["tryHandleGatewayStop"],
  },
  {
    file: "patches/doctor-receipt-metrics.patch",
    target: "src/cli/doctor.mjs",
    needles: ["pushReceiptMetricsChecks"],
  },
];

function applied(e) {
  const t = fs.readFileSync(path.join(root, e.target), "utf8");
  return e.needles.every((n) => t.includes(n));
}

let need = 0;
let appliedN = 0;
for (const e of BATCH3) {
  if (applied(e)) {
    console.error(`[land-batch3] OK ${e.file}`);
    appliedN += 1;
    continue;
  }
  if (check) {
    console.error(`[land-batch3] NEED ${e.file}`);
    need += 1;
    continue;
  }
  const r = spawnSync("git", ["apply", "--whitespace=nowarn", path.join(root, e.file)], {
    cwd: root,
    encoding: "utf8",
  });
  if (r.status === 0 || applied(e)) {
    console.error(`[land-batch3] APPLIED ${e.file}`);
    appliedN += 1;
  } else {
    console.error(`[land-batch3] FAIL ${e.file}: ${(r.stderr || "").slice(0, 240)}`);
    process.exit(1);
  }
}
if (check && need) process.exit(1);
console.error(`[land-batch3] done applied=${appliedN} need=${need}`);
process.exit(0);
