/**
 * Spend accounting for the live horizon soak.
 *
 * The soak's dollar cap was compared against `policy.usedUsd`, which was
 * assigned once from the checkpoint and never incremented — so
 * `usedUsd > maxUsd` was `0 > 2` on every call, for every goal, on fresh runs
 * and resumes alike. Five goals ran against a cap that could not fire.
 *
 * Extracted as a primitive rather than inlined in the loop: the "which field
 * carries cost" question below is the whole defect, and a decision that lives
 * inside an async goal loop cannot be tested without running one.
 */

/**
 * What one agent result cost, and whether that is a measurement or a guess.
 *
 * The cost is at `result.usage.costUsd` — `runAgent` returns `usage: raw.usage`
 * and the loop returns the tracker's snapshot. Reading `result.costUsd`, the
 * obvious guess, yields undefined on every real run and would leave any
 * accumulator built on it permanently at zero.
 *
 * An un-priced turn reads as UNKNOWN, never as free. The tracker returns null
 * wholesale when disabled and `costUsd: null` when the provider reported no
 * cost; counting either as $0 is how a cap silently stops bounding anything.
 *
 * @param {object} result agent result
 * @returns {{usd: number, known: boolean}}
 */
export function turnCostUsd(result) {
  const usage = result?.usage;
  if (!usage || usage.hasCost !== true) return { usd: 0, known: false };
  // Number(null) is 0, and 0 is finite — so coercing first turned the exact
  // shape this function exists to reject ("hasCost, but the provider priced
  // nothing") into a measured $0.00. objective.mjs:83 already tests the raw
  // value with Number.isFinite; this now matches it.
  const usd = usage.costUsd;
  if (typeof usd !== "number" || !Number.isFinite(usd))
    return { usd: 0, known: false };
  return { usd, known: true };
}

/**
 * Fold one result into a running total, counting what could not be priced.
 *
 * `unpricedTurns` is the honesty channel: a report saying "$0 of $1.50" after
 * five un-priced turns states a measurement nobody took.
 *
 * @param {{usedUsd?: number, unpricedTurns?: number}} state
 * @param {object} result
 */
export function accumulateSpend(state, result) {
  const prev = {
    usedUsd: Number(state?.usedUsd ?? 0) || 0,
    unpricedTurns: Number(state?.unpricedTurns ?? 0) || 0,
  };
  const { usd, known } = turnCostUsd(result);
  return {
    usedUsd: prev.usedUsd + (known ? usd : 0),
    unpricedTurns: prev.unpricedTurns + (known ? 0 : 1),
  };
}

/**
 * The budget one goal may spend: what the soak has left, never more than the
 * operator's own configured ceiling. A soak remainder must be able to tighten
 * a configured budget and must never loosen one.
 *
 * Exhaustion is a bound of ZERO, never an absent bound. Dropping a
 * non-positive remainder from the candidate list meant a soak that had spent
 * its budget to the penny produced `null` — which the caller spreads as no
 * `maxUsd` key at all, and cost-governor.mjs:31 only blocks when `maxUsd > 0`.
 * The one state where the brake matters most released it entirely.
 *
 * @param {number|null|undefined} configured cfg.agent.budget.maxUsd
 * @param {number} remaining soak budget not yet spent
 * @returns {number|null} 0 when the soak has no headroom left; null when
 *   neither side bounds it at all
 */
export function budgetForTurn(configured, remaining) {
  const cfgUsd = Number(configured);
  const rem = Number(remaining);
  if (Number.isFinite(rem) && rem <= 0) return 0;
  const bounds = [];
  if (Number.isFinite(cfgUsd) && cfgUsd > 0) bounds.push(cfgUsd);
  if (Number.isFinite(rem) && rem > 0) bounds.push(rem);
  return bounds.length ? Math.min(...bounds) : null;
}
