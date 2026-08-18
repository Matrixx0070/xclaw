/**
 * Budget transfer across provider failover.
 * Remaining job USD / turns / tokens carry to the secondary model.
 */

/**
 * Remaining budget after spend (never negative).
 * @param {object} budget
 * @returns {{ remainingUsd: number|null, remainingTurns: number|null, remainingTokens: number|null }}
 */
export function remainingBudget(budget = {}) {
  const remainingUsd =
    budget.maxUsd != null
      ? Math.max(0, Number(budget.maxUsd) - Number(budget.spentUsd || 0))
      : null;
  const remainingTurns =
    budget.maxTurns != null
      ? Math.max(0, Number(budget.maxTurns) - Number(budget.turns || 0))
      : null;
  const remainingTokens =
    budget.maxTokens != null
      ? Math.max(0, Number(budget.maxTokens) - Number(budget.tokens || 0))
      : null;
  return { remainingUsd, remainingTurns, remainingTokens };
}

/**
 * Transfer remaining budget to secondary model (primary spend already recorded).
 * @param {object} budget
 * @param {{ fromRef?: string, toRef?: string, reason?: string }} [meta]
 */
export function transferBudgetOnFailover(budget = {}, meta = {}) {
  const rem = remainingBudget(budget);
  const next = {
    ...budget,
    maxUsd:
      rem.remainingUsd != null
        ? rem.remainingUsd + Number(budget.spentUsd || 0)
        : budget.maxUsd,
    maxTurns:
      rem.remainingTurns != null
        ? rem.remainingTurns + Number(budget.turns || 0)
        : budget.maxTurns,
    maxTokens:
      rem.remainingTokens != null
        ? rem.remainingTokens + Number(budget.tokens || 0)
        : budget.maxTokens,
    transfer: {
      at: new Date().toISOString(),
      fromRef: meta.fromRef || null,
      toRef: meta.toRef || null,
      reason: meta.reason || "failover",
      remainingUsd: rem.remainingUsd,
      remainingTurns: rem.remainingTurns,
      remainingTokens: rem.remainingTokens,
    },
  };
  return next;
}

/**
 * True when remaining budget is exhausted (no more failover value).
 * @param {object} budget
 */
export function isBudgetExhausted(budget = {}) {
  const rem = remainingBudget(budget);
  if (rem.remainingUsd != null && rem.remainingUsd <= 0) return true;
  if (rem.remainingTurns != null && rem.remainingTurns <= 0) return true;
  if (rem.remainingTokens != null && rem.remainingTokens <= 0) return true;
  return false;
}

export default {
  remainingBudget,
  transferBudgetOnFailover,
  isBudgetExhausted,
};
