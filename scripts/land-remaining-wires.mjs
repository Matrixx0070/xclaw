#!/usr/bin/env node
/**
 * Apply remaining production-wire patches (idempotent via needles).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

export const REMAINING_WIRES = [
  {
    file: "patches/loop-cost-auth-refresh.patch",
    target: "src/agent/loop.mjs",
    needles: ["checkLoopCostBudget", "loop-cost-check.mjs"],
  },
  {
    file: "patches/job-claims-soft-retry-budget.patch",
    target: "src/jobs/job.mjs",
    needles: ["runClaimsGateWithSoftRetry", "stampJobClaimsSoftRetry"],
  },
  {
    file: "patches/checkpoint-hash-verify-wire.patch",
    target: "src/jobs/checkpoint.mjs",
    needles: ["verifyCheckpointToolHash"],
  },
  {
    file: "patches/doctor-auth-refresh.patch",
    target: "src/cli/doctor.mjs",
    needles: ["pushAuthRefreshChecks", "ops.auth_refresh"],
  },
  {
    file: "patches/ws-hub-close-all.patch",
    target: "src/gateway/ws-hub.mjs",
    needles: ["export function closeAllWebSockets"],
  },
];

function applied(e) {
  const t = fs.readFileSync(path.join(root, e.target), "utf8");
  return e.needles.every((n) => t.includes(n));
}

let need = 0;
let appliedN = 0;
for (const e of REMAINING_WIRES) {
  if (applied(e)) {
    console.error(`[land-wires] OK ${e.file}`);
    appliedN += 1;
    continue;
  }
  if (check) {
    console.error(`[land-wires] NEED ${e.file}`);
    need += 1;
    continue;
  }
  const r = spawnSync("git", ["apply", "--whitespace=nowarn", path.join(root, e.file)], {
    cwd: root,
    encoding: "utf8",
  });
  if (r.status === 0 || applied(e)) {
    console.error(`[land-wires] APPLIED ${e.file}`);
    appliedN += 1;
  } else {
    console.error(`[land-wires] FAIL ${e.file}: ${(r.stderr || "").slice(0, 240)}`);
    process.exit(1);
  }
}
if (check && need) process.exit(1);
console.error(`[land-wires] done applied=${appliedN} need=${need}`);
process.exit(0);
