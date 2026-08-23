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
  // The collector seeds claimsSoftRetry as a pristine {max:0} default; the
  // real budget is stamped by the claims gate. Copying the untouched default
  // over a stamped budget zeroed every receipt and hid the retry state
  // (2026-08-23 soak diagnosis). Only copy when the collector carries data
  // or the job has nothing yet.
  const soft = collector.claimsSoftRetry;
  const softHasData =
    soft &&
    (Number(soft.max) > 0 ||
      Number(soft.used) > 0 ||
      (Array.isArray(soft.attempts) && soft.attempts.length > 0));
  if (soft && (softHasData || !job.claimsSoftRetry)) {
    job.claimsSoftRetry = soft;
  }
  if (collector.quotaHardCircuit || job.quotaHardCircuit) {
    job.quotaHardCircuit = job.quotaHardCircuit || collector.quotaHardCircuit;
  }
  return job;
}

/**
 * Ensure hard-circuit survives mid-loop abort / force-stop history writes.
 * Sources: job, collector, receiptMetrics, agentResult.
 */
export function ensureQuotaHardCircuitOnJob(job) {
  if (!job || typeof job !== "object") return job;
  const sources = [
    job.quotaHardCircuit,
    job.receiptCollector?.quotaHardCircuit,
    job.collector?.quotaHardCircuit,
    job.receiptMetrics?.quotaHardCircuit,
    job.agentResult?.quotaHardCircuit,
  ].filter(Boolean);
  const trip = sources.find((s) => s && s.tripped);
  if (trip) job.quotaHardCircuit = { ...trip, tripped: true };
  else if (sources[0]) job.quotaHardCircuit = sources[0];
  if (!job.quotaHardCircuit?.tripped) {
    const q = job.quotaEscalate || job.receiptCollector?.quotaEscalate || {};
    const hard = Number(q.hardBlocks) || 0;
    const limit = Number(job.quotaHardCircuit?.limit || q.limit || 3);
    if (hard >= limit && hard > 0) {
      job.quotaHardCircuit = {
        tripped: true,
        hardBlocks: hard,
        limit,
        at: new Date().toISOString(),
        synthesized: true,
      };
    }
  }
  return job;
}

export default {
  createReceiptCollector,
  copyCollectorOntoJob,
  ensureQuotaHardCircuitOnJob,
};
