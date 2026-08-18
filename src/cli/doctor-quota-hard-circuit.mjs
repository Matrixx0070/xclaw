/**
 * Doctor: quota hard-circuit trips from recent job receipts.
 */
import fs from "node:fs";
import path from "node:path";

export function loadRecentJobs(root, limit = 20) {
  const idx = path.join(root, "reports", "jobs", "index.jsonl");
  if (!fs.existsSync(idx)) return [];
  return fs
    .readFileSync(idx, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .slice(-limit);
}

export function summarizeHardCircuits(jobs = []) {
  let tripped = 0;
  let hardBlocks = 0;
  for (const j of jobs) {
    if (j?.quotaHardCircuit?.tripped) tripped += 1;
    hardBlocks += Number(j?.quotaEscalate?.hardBlocks || j?.quotaHardCircuit?.hardBlocks) || 0;
  }
  return {
    jobs: jobs.length,
    tripped,
    hardBlocks,
    tripRate: jobs.length ? tripped / jobs.length : 0,
  };
}

export function pushQuotaHardCircuitChecks(push, root = process.cwd(), opts = {}) {
  const jobs = loadRecentJobs(root, opts.limit || 20);
  const s = summarizeHardCircuits(jobs);
  const maxTripRate = Number(
    opts.maxTripRate ?? process.env.XCLAW_MAX_HARD_CIRCUIT_TRIP_RATE ?? 0.1
  );
  let status = "ok";
  if (!jobs.length) status = "warn";
  else if (s.tripped > 0 && s.tripRate > maxTripRate) status = "error";
  else if (s.tripped > 0) status = "warn";
  push(
    "ops.quota_hard_circuit",
    status,
    `hard-circuit trips=${s.tripped}/${s.jobs} hardBlocks=${s.hardBlocks}`,
    { ...s, maxTripRate }
  );
  return { status, ...s };
}

export default {
  pushQuotaHardCircuitChecks,
  summarizeHardCircuits,
  loadRecentJobs,
};
