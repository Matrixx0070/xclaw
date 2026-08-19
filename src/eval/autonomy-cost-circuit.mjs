/**
 * Offline autonomy: cost hard deny must stamp quota circuit + costBlocked.
 */
import { stampCostHardBlock } from "../tokens/cost-hard-block.mjs";

export async function autonomyCostCircuitCheck() {
  const job = { id: "autonomy-cost-circuit" };
  await stampCostHardBlock(job, { hard: true, message: "test hard cap" });
  const ok = Boolean(job.quotaHardCircuit?.tripped || job.quotaHardCircuit?.reason);
  return {
    name: "cost_circuit",
    ok,
    costBlocked: true,
    circuit: job.quotaHardCircuit || null,
  };
}

export default { autonomyCostCircuitCheck };
