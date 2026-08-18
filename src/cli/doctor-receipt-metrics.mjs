/**
 * Doctor check: sample receiptMetrics from recent job history.
 */
import { listJobs } from "../jobs/history.mjs";

export async function pushReceiptMetricsChecks(push, cfg = {}) {
  let jobs = [];
  try {
    jobs = await listJobs(cfg, { limit: 20 });
  } catch (e) {
    push("ops.receipt_metrics", "warn", e.message || String(e), { present: false });
    return { present: false };
  }

  const withRm = jobs.filter((j) => j.receiptMetrics || j.claimsSoftRetry || j.quotaEscalate);
  if (!jobs.length) {
    push("ops.receipt_metrics", "warn", "no job history yet", { present: false, sampled: 0 });
    return { present: false, sampled: 0 };
  }
  if (!withRm.length) {
    push(
      "ops.receipt_metrics",
      "warn",
      `sampled ${jobs.length} jobs, none have receiptMetrics`,
      { present: false, sampled: jobs.length }
    );
    return { present: false, sampled: jobs.length };
  }

  const totals = withRm.reduce(
    (acc, j) => {
      const rm = j.receiptMetrics || {};
      const soft = rm.claimsSoftRetry || j.claimsSoftRetry || {};
      const q = rm.quotaEscalate || j.quotaEscalate || {};
      acc.softUsed += Number(soft.used) || 0;
      acc.softWarns += Number(q.softWarns) || 0;
      acc.hardBlocks += Number(q.hardBlocks) || 0;
      acc.escalated += Number(q.escalatedFromSoft) || 0;
      return acc;
    },
    { softUsed: 0, softWarns: 0, hardBlocks: 0, escalated: 0 }
  );

  const status = totals.hardBlocks > 0 ? "warn" : "ok";
  push(
    "ops.receipt_metrics",
    status,
    `sampled ${withRm.length}/${jobs.length} jobs softRetryUsed=${totals.softUsed} quotaSoft=${totals.softWarns} quotaHard=${totals.hardBlocks} escalated=${totals.escalated}`,
    { present: true, sampled: jobs.length, withMetrics: withRm.length, totals }
  );
  return { present: true, sampled: jobs.length, withMetrics: withRm.length, totals };
}

export default { pushReceiptMetricsChecks };
