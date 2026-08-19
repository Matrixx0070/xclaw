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

export async function beforeLiveTurn(ctx = {}) {
  incLiveTurn();
  const guards = [];

  try {
    const cg = await import("../agent/cost-governor.mjs");
    const check = cg.checkCost || cg.default?.checkCost || cg.evaluate;
    if (typeof check === "function") {
      const r = await check(ctx);
      guards.push({
        name: "cost",
        ...(r && typeof r === "object" ? r : { ok: r !== false }),
      });
      if (r && r.ok === false)
        return { ok: false, code: r.code || "COST_GOVERNOR", guards };
    }
  } catch {
    guards.push({ name: "cost", ok: true, skipped: true });
  }

  try {
    const rec = await import("../agent/high-risk-receipt.mjs");
    const fn = rec.requireReceipt || rec.default?.requireReceipt;
    if (typeof fn === "function" && ctx.highRisk) {
      const r = await fn(ctx);
      guards.push({
        name: "receipt",
        ...(r && typeof r === "object" ? r : { ok: r !== false }),
      });
      if (r && r.ok === false)
        return { ok: false, code: r.code || "RECEIPT_REQUIRED", guards };
    }
  } catch {
    guards.push({ name: "receipt", ok: true, skipped: true });
  }

  return { ok: true, guards };
}

export async function afterLiveTurn(ctx = {}) {
  try {
    const can = await import("../agent/hallucination-canary.mjs");
    const fn = can.checkCanary || can.default?.checkCanary;
    if (typeof fn === "function") {
      const r = await fn(ctx);
      if (r && r.ok === false) return { ok: false, code: r.code || "CANARY", r };
    }
  } catch {
    /* optional */
  }
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
