/**
 * Per-live-turn guards: canary, cost, high-risk receipt, checkpoint.
 */
import { saveSoakCheckpoint } from "./horizon-soak-checkpoint.mjs";

const state = { live_turn_total: 0, last: null };

export function incLiveTurn(n = 1) {
  state.live_turn_total += n;
  return state.live_turn_total;
}
export function getLiveTurnTotal() {
  return state.live_turn_total;
}
export function resetLiveTurnMetrics() {
  state.live_turn_total = 0;
}
export function renderLiveTurnMetrics() {
  return `xclaw_horizon_live_turn_total ${state.live_turn_total}\n`;
}
export function lastLiveRun() {
  return state.last;
}
export function noteLastLiveRun(info) {
  state.last = { ...info, at: new Date().toISOString() };
  return state.last;
}

/**
 * Pre-turn gate for one live soak goal.
 *
 * This used to hold three guards, each reached through a dynamic import and a
 * `a.x || a.default?.x || a.y` chain of names that no target module exports:
 * `checkCost`/`evaluate` on cost-governor.mjs (real export: createCostGovernor),
 * `requireReceipt` on high-risk-receipt.mjs (real export: guardHighRiskReceipt),
 * `checkCanary` on hallucination-canary.mjs (real export: runHallucinationCanary).
 * A missing property on a namespace object is `undefined`, not an error, so the
 * `typeof fn === "function"` test simply skipped — and because the imports
 * themselves succeeded, the surrounding catch never fired and never pushed its
 * `skipped: true` breadcrumb either. The function returned `{ok:true, guards:[]}`,
 * which reads exactly like "every guard ran and passed".
 *
 * They are gone rather than repaired, because each one duplicated enforcement
 * that already runs a layer down, on every turn of every channel:
 *   - cost: the soak's own aggregate ceiling is now checked per goal in
 *     horizon-live.mjs (checkSoakCaps against accumulated spend), and the
 *     per-run brake is createCostGovernor at loop.mjs:856, fed each turn.
 *   - receipt: guardHighRiskReceipt runs per TOOL CALL at loop.mjs:1483, which
 *     is strictly stronger than a per-turn check that has no tool name to test.
 *   - canary: runHallucinationCanary runs per run at loop.mjs:2164, with the
 *     soft-recovery path in canary-recover.mjs.
 * Re-adding any of them here should mean adding something those cannot see.
 */
export async function beforeLiveTurn() {
  incLiveTurn();
  return { ok: true, guards: [] };
}

export async function afterLiveTurn(ctx = {}) {
  if (ctx.soakJobId) {
    await saveSoakCheckpoint(
      ctx.soakJobId,
      {
        turns: ctx.turns,
        usedUsd: ctx.usedUsd,
        workspace: ctx.workspace,
        receipts: ctx.receipts || [],
      },
      { base: ctx.soakBase }
    );
  }
  noteLastLiveRun({
    mode: ctx.mode || "live",
    soakJobId: ctx.soakJobId || null,
    turns: ctx.turns || 0,
  });
  return { ok: true };
}

export default {
  beforeLiveTurn,
  afterLiveTurn,
  incLiveTurn,
  renderLiveTurnMetrics,
  lastLiveRun,
};
