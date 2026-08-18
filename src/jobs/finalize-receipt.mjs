/**
 * Copy receipt collector + hard-circuit onto a job before history write.
 */
import {
  copyCollectorOntoJob,
  ensureQuotaHardCircuitOnJob,
} from "./receipt-collector.mjs";

export function attachReceiptCollectorToJob(job, extra = {}) {
  if (!job || typeof job !== "object") return job;
  const collector =
    extra.collector ||
    extra.receiptCollector ||
    extra.agentResult?.receiptCollector ||
    extra.agentResult?.collector ||
    job.receiptCollector ||
    job.collector;
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

export default { attachReceiptCollectorToJob };
