/**
 * Copy receipt collector + hard-circuit onto a job before history write.
 */
import {
  createReceiptCollector,
  copyCollectorOntoJob,
  ensureQuotaHardCircuitOnJob,
} from "./receipt-collector.mjs";

/** Always have a per-job collector (force-stop / mid-loop safe). */
export function ensureJobReceiptCollector(job, seed = {}) {
  if (!job || typeof job !== "object") return null;
  if (!job.receiptCollector) {
    job.receiptCollector = createReceiptCollector(seed);
  }
  return job.receiptCollector;
}

export function attachReceiptCollectorToJob(job, extra = {}) {
  if (!job || typeof job !== "object") return job;
  const collector =
    extra.collector ||
    extra.receiptCollector ||
    extra.agentResult?.receiptCollector ||
    extra.agentResult?.collector ||
    job.receiptCollector ||
    job.collector ||
    ensureJobReceiptCollector(job, extra.seed);
  if (collector) {
    copyCollectorOntoJob(job, collector);
    job.receiptCollector = collector;
  }
  if (extra.agentResult?.quotaHardCircuit) {
    job.quotaHardCircuit =
      job.quotaHardCircuit || extra.agentResult.quotaHardCircuit;
  }
  if (extra.agentResult?.quotaEscalate) {
    job.quotaEscalate = job.quotaEscalate || extra.agentResult.quotaEscalate;
  }
  ensureQuotaHardCircuitOnJob(job);
  return job;
}

export default {
  attachReceiptCollectorToJob,
  ensureJobReceiptCollector,
};
