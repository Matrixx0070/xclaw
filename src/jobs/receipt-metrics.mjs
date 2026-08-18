/**
 * Unified receipt metrics for autonomy eval / soak:
 * claims soft-retry budget + quota soft→hard escalate counters.
 */

export function buildReceiptMetrics(job = {}) {
  const soft = job.claimsSoftRetry || job.softRetryBudget || null;
  const claimsSoftRetry = soft
    ? {
        max: Number(soft.max) || 0,
        used: Number(soft.used) || 0,
        remaining:
          soft.remaining != null
            ? Number(soft.remaining)
            : Math.max(0, (Number(soft.max) || 0) - (Number(soft.used) || 0)),
        attempts: Array.isArray(soft.attempts) ? soft.attempts.length : soft.attempts ?? 0,
      }
    : { max: 0, used: 0, remaining: 0, attempts: 0 };

  const q = job.quotaEscalate || job.quota || null;
  const quotaEscalate = {
    softWarns: Number(q?.softWarns ?? job.quotaSoftWarns ?? 0) || 0,
    hardBlocks: Number(q?.hardBlocks ?? job.quotaHardBlocks ?? 0) || 0,
    escalatedFromSoft:
      Number(q?.escalatedFromSoft ?? job.quotaEscalatedFromSoft ?? 0) || 0,
    lastCode: q?.lastCode || job.quotaLastCode || null,
  };

  return {
    claimsSoftRetry,
    quotaEscalate,
    at: new Date().toISOString(),
  };
}

export function stampReceiptMetrics(job, extra = {}) {
  if (!job || typeof job !== "object") return job;
  if (extra.claimsSoftRetry) {
    job.claimsSoftRetry = { ...(job.claimsSoftRetry || {}), ...extra.claimsSoftRetry };
  }
  if (extra.quotaEscalate) {
    job.quotaEscalate = { ...(job.quotaEscalate || {}), ...extra.quotaEscalate };
  }
  job.receiptMetrics = buildReceiptMetrics(job);
  return job;
}

export function recordQuotaEscalateEvent(collector, event = {}) {
  if (!collector || typeof collector !== "object") return collector;
  const q = (collector.quotaEscalate = collector.quotaEscalate || {
    softWarns: 0,
    hardBlocks: 0,
    escalatedFromSoft: 0,
    lastCode: null,
  });
  if (event.soft || event.phase === "soft_warn") q.softWarns += 1;
  if (event.hard || event.phase === "hard" || event.ok === false) q.hardBlocks += 1;
  if (event.escalatedFromSoft) q.escalatedFromSoft += 1;
  if (event.code || event.reason) q.lastCode = event.code || event.reason;
  return collector;
}

export default {
  buildReceiptMetrics,
  stampReceiptMetrics,
  recordQuotaEscalateEvent,
};
