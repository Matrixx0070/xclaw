/**
 * Cost governor — hard-block when spend/tokens exceed ceiling.
 */
import { createRunBudget } from "./run-budget.mjs";
import {
  isHardBlockCircuitTripped,
  tripHardBlockCircuit,
} from "./quota-hard-circuit.mjs";

export function createCostGovernor(cfg = {}, job = {}) {
  const budget = createRunBudget(cfg);
  let spentUsd = Number(job.spentUsd) || 0;
  let totalTokens = Number(job.totalTokens) || 0;
  const maxUsd = Number(cfg?.agent?.budget?.maxUsd ?? cfg?.cost?.maxUsd ?? 0) || null;

  function record({ tokens = 0, usd = 0 } = {}) {
    totalTokens += Number(tokens) || 0;
    spentUsd += Number(usd) || 0;
  }

  function check(state = {}) {
    if (isHardBlockCircuitTripped(job)) {
      return { blocked: true, reason: "quota_hard_circuit" };
    }
    const b = budget.check({
      toolCalls: state.toolCalls ?? job.toolCalls ?? 0,
      totalTokens: state.totalTokens ?? totalTokens,
      now: state.now,
    });
    if (b) return { blocked: true, reason: b.reason, ...b };
    if (maxUsd != null && maxUsd > 0 && spentUsd >= maxUsd) {
      return { blocked: true, reason: "max_usd", limit: maxUsd, used: spentUsd };
    }
    return { blocked: false, spentUsd, totalTokens };
  }

  function forceHardBlock(detail = {}) {
    return tripHardBlockCircuit(job, detail.cfg || cfg);
  }

  return {
    record,
    check,
    forceHardBlock,
    snapshot: () => ({ spentUsd, totalTokens }),
  };
}

export default { createCostGovernor };
