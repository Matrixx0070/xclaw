/**
 * Agent-loop cost preflight: OAuth refresh → cost governor → seat budget.
 */
import { dualBudgetPreflight } from "./dual-preflight.mjs";
import { checkJobCostBudget } from "./cost-governor.mjs";

export async function checkLoopCostBudget(cfg, opts = {}) {
  return dualBudgetPreflight(cfg, {
    apps: opts.apps,
    force: opts.force,
    requireAuth: opts.requireAuth === true || cfg?.cost?.requireAuthBeforeBudget === true,
    ensureFresh: opts.ensureFresh,
    estimateUsd: opts.estimateUsd,
    estimateTokens: opts.estimateTokens,
    peer: opts.peer || opts.seatPeer || opts.from,
  });
}

export { checkJobCostBudget };

export default { checkLoopCostBudget, checkJobCostBudget };
