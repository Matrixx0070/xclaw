/**
 * When cost governor hard-denies a job, trip quota hard-circuit.
 */
export async function stampCostHardBlock(job, check) {
  if (!job || !check || !(check.hard || check.paused)) return job;
  job.quotaHardCircuit = {
    tripped: true,
    reason: "cost_governor_hard",
    message: check.message || "COST_HARD_CAP",
    at: new Date().toISOString(),
  };
  try {
    const { recordHardBlock } = await import("../agent/quota-hard-circuit.mjs");
    recordHardBlock(job, {
      code: "COST_HARD_CAP",
      reason: "cost_governor_hard",
      message: check.message || "COST_HARD_CAP",
    });
  } catch {
    /* optional */
  }
  return job;
}

export default { stampCostHardBlock };
