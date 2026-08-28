/**
 * Doctor: quota hard-circuit trips from recent job receipts.
 *
 * The row used to warn whenever the receipt index held nothing, and printed
 * `trips=0/0 hardBlocks=0` while doing it — a line that reads as a clean
 * measurement, attached to a status that says something is wrong. On a host
 * that has never run a /job there IS no reports/jobs/index.jsonl, so the row
 * warned permanently and said the same words it would say about a host running
 * jobs cleanly. Measured live at 3.313.0: the file did not exist and the row
 * had been warning about it in every doctor run.
 *
 * No sample is not a fault; it is the absence of evidence either way. The
 * doctor already has a level for that (see cron.ledger, "not created yet"),
 * and using it keeps `warn` meaning "I measured something you should look at".
 */
import fs from "node:fs";
import path from "node:path";

/** Where job receipts accumulate. Exported so the probe can say it out loud. */
export function jobIndexPath(root) {
  return path.join(root, "reports", "jobs", "index.jsonl");
}

export function loadRecentJobs(root, limit = 20) {
  const idx = jobIndexPath(root);
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

  // Nothing to measure: say which artifact is absent instead of reporting a
  // rate over an empty denominator.
  if (!s.jobs) {
    push(
      "ops.quota_hard_circuit",
      "info",
      `no job receipts yet (${jobIndexPath(root)}) — nothing to measure`,
      { ...s, maxTripRate, noData: true }
    );
    return { status: "info", ...s };
  }

  const status = s.tripped > 0 ? (s.tripRate > maxTripRate ? "error" : "warn") : "ok";
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
  jobIndexPath,
};
