/**
 * Per-job collector for quota escalate + claims soft-retry.
 */
export function createReceiptCollector(seed = {}) {
  return {
    quotaEscalate: {
      softWarns: 0,
      hardBlocks: 0,
      escalatedFromSoft: 0,
      lastCode: null,
      ...(seed.quotaEscalate || {}),
    },
    claimsSoftRetry: {
      max: seed.claimsSoftRetry?.max ?? 0,
      used: seed.claimsSoftRetry?.used ?? 0,
      remaining: seed.claimsSoftRetry?.remaining ?? 0,
      attempts: seed.claimsSoftRetry?.attempts || [],
    },
    quotaHardCircuit: seed.quotaHardCircuit || null,
  };
}

export function copyCollectorOntoJob(job, collector) {
  if (!job || !collector) return job;
  if (collector.quotaEscalate) job.quotaEscalate = collector.quotaEscalate;
  if (collector.claimsSoftRetry) job.claimsSoftRetry = collector.claimsSoftRetry;
  if (collector.quotaHardCircuit || job.quotaHardCircuit) {
    job.quotaHardCircuit = job.quotaHardCircuit || collector.quotaHardCircuit;
  }
  return job;
}

export default { createReceiptCollector, copyCollectorOntoJob };
