/**
 * After N workspace-quota hard blocks in one job, fail-closed (no more tools).
 */
export function hardBlockLimit(cfg = {}) {
  const n = Number(
    cfg.quota?.maxHardBlocksPerJob ??
      process.env.XCLAW_MAX_HARD_BLOCKS_PER_JOB ??
      3
  );
  return Number.isFinite(n) && n > 0 ? n : 3;
}

export function recordHardBlock(job, detail = {}) {
  if (!job) return { tripped: false, skipped: true };
  if (!job.quotaEscalate) {
    job.quotaEscalate = { softWarns: 0, hardBlocks: 0, escalatedFromSoft: 0, lastCode: null };
  }
  job.quotaEscalate.hardBlocks = (Number(job.quotaEscalate.hardBlocks) || 0) + 1;
  if (detail.code) job.quotaEscalate.lastCode = detail.code;
  if (detail.escalatedFromSoft) {
    job.quotaEscalate.escalatedFromSoft =
      (Number(job.quotaEscalate.escalatedFromSoft) || 0) + 1;
  }
  return tripHardBlockCircuit(job, detail.cfg || {});
}

export function tripHardBlockCircuit(job, cfg = {}) {
  if (!job?.quotaEscalate) return { tripped: false, hardBlocks: 0 };
  const hardBlocks = Number(job.quotaEscalate.hardBlocks) || 0;
  const limit = hardBlockLimit(cfg);
  const tripped = hardBlocks >= limit;
  if (tripped) {
    job.quotaHardCircuit = {
      tripped: true,
      hardBlocks,
      limit,
      at: new Date().toISOString(),
    };
  }
  return { tripped, hardBlocks, limit };
}

export function isHardBlockCircuitTripped(job) {
  return Boolean(job?.quotaHardCircuit?.tripped);
}

export function hardBlockCircuitMessage(job) {
  const c = job?.quotaHardCircuit || {};
  return `QUOTA_HARD_CIRCUIT: ${c.hardBlocks || 0}/${c.limit || "?"} hard blocks — refusing further tools`;
}

/** Guard before tool dispatch — returns deny payload if circuit open. */
export function guardToolAgainstHardCircuit(job) {
  if (!isHardBlockCircuitTripped(job)) return { ok: true };
  return {
    ok: false,
    reason: "QUOTA_HARD_CIRCUIT",
    message: hardBlockCircuitMessage(job),
  };
}

export default {
  hardBlockLimit,
  recordHardBlock,
  tripHardBlockCircuit,
  isHardBlockCircuitTripped,
  hardBlockCircuitMessage,
  guardToolAgainstHardCircuit,
};
