/**
 * Agent-loop cost preflight: OAuth/seat token refresh then cost governor.
 */
import { checkCostBudgetWithAuthRefresh } from "./cost-preflight-auth.mjs";
import { checkJobCostBudget } from "./cost-governor.mjs";

/**
 * @param {object} cfg
 * @param {object} [opts]
 * @returns {Promise<object>} budget result (includes auth when refreshed)
 */
export async function checkLoopCostBudget(cfg, opts = {}) {
  return checkCostBudgetWithAuthRefresh(cfg, {
    apps: opts.apps,
    force: opts.force,
    requireAuth: opts.requireAuth === true || cfg?.cost?.requireAuthBeforeBudget === true,
    ensureFresh: opts.ensureFresh,
    estimateUsd: opts.estimateUsd,
  });
}

export { checkJobCostBudget };

export default { checkLoopCostBudget, checkJobCostBudget };
