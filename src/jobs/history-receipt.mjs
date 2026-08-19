/**
 * Persist receipt collector snapshot on history rows.
 */
export function snapshotReceiptForHistory(job) {
  if (!job || typeof job !== "object") return {};
  const c = job.receiptCollector || job.collector || {};
  return {
    quotaEscalate: job.quotaEscalate || c.quotaEscalate || null,
    quotaHardCircuit: job.quotaHardCircuit || c.quotaHardCircuit || null,
    receiptMetrics: job.receiptMetrics || c.metrics || null,
  };
}

export function mergeReceiptSnapshotIntoJob(job) {
  if (!job || typeof job !== "object") return job;
  const snap = snapshotReceiptForHistory(job);
  if (snap.quotaEscalate) job.quotaEscalate = job.quotaEscalate || snap.quotaEscalate;
  if (snap.quotaHardCircuit) job.quotaHardCircuit = job.quotaHardCircuit || snap.quotaHardCircuit;
  if (snap.receiptMetrics) job.receiptMetrics = job.receiptMetrics || snap.receiptMetrics;
  if (job.receiptCollector && typeof job.receiptCollector === "object") {
    job.receiptCollector = {
      quotaEscalate: job.receiptCollector.quotaEscalate || null,
      quotaHardCircuit: job.receiptCollector.quotaHardCircuit || null,
    };
  }
  return job;
}

export default { snapshotReceiptForHistory, mergeReceiptSnapshotIntoJob };
