/**
 * Restore quota/soft-retry counters when resuming from a checkpoint.
 */
import { createReceiptCollector, copyCollectorOntoJob } from "./receipt-collector.mjs";

export function receiptFromCheckpoint(cp = {}) {
  return createReceiptCollector({
    quotaEscalate: cp.quotaEscalate || cp.receiptMetrics?.quotaEscalate || {},
    claimsSoftRetry: cp.claimsSoftRetry || cp.receiptMetrics?.claimsSoftRetry || {},
  });
}

export function applyCheckpointReceipt(job, cp) {
  const collector = receiptFromCheckpoint(cp);
  copyCollectorOntoJob(job, collector);
  if (cp.receiptMetrics) job.receiptMetrics = cp.receiptMetrics;
  return { job, collector };
}

export default { receiptFromCheckpoint, applyCheckpointReceipt };
