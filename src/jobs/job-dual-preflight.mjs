/**
 * runJob dual preflight (auth + cost + seat) before the agent starts.
 */
import { dualBudgetPreflight } from "../tokens/dual-preflight.mjs";

export async function preflightJobBudgets(cfg, opts = {}) {
  if (!cfg) return { ok: true, skipped: true };
  return dualBudgetPreflight(cfg, {
    peer: opts.peer || opts.seatPeer || opts.from || null,
    estimateUsd: opts.estimateUsd,
    estimateTokens: opts.estimateTokens,
    apps: opts.apps,
    ensureFresh: opts.ensureFresh,
    requireAuth: opts.requireAuth,
  });
}

export function budgetBlockedJob({ id, goal, workspace, r }) {
  return {
    id,
    goal,
    workspace,
    status: "failed",
    pass: false,
    turns: 0,
    toolCalls: 0,
    toolErrors: 0,
    wallMs: 0,
    text: "",
    error: r.message || (r.blockedBy === "seat" ? "seat hard cap" : "cost hard cap"),
    code: r.code || (r.blockedBy === "seat" ? "SEAT_BUDGET_EXCEEDED" : "BUDGET_EXCEEDED"),
    costBlocked: r.blockedBy === "cost",
    seatBlocked: r.blockedBy === "seat",
    seat: r.seat?.seat || null,
    dualPreflight: r,
    evidence: [],
  };
}

export default { preflightJobBudgets, budgetBlockedJob };
