/**
 * Dual preflight: OAuth/seat-token refresh → cost governor → seat budget.
 * Single entry point before provider / job start.
 */
import { checkCostBudgetWithAuthRefresh } from "./cost-preflight-auth.mjs";
import { checkSeatBudget, seatsEnabled } from "../seats/manager.mjs";

/**
 * @param {object} cfg
 * @param {object} [opts]
 * @returns {Promise<object>}
 */
export async function dualBudgetPreflight(cfg = {}, opts = {}) {
  const cost = await checkCostBudgetWithAuthRefresh(cfg, {
    estimateUsd: opts.estimateUsd,
    apps: opts.apps,
    force: opts.force,
    requireAuth: opts.requireAuth,
    ensureFresh: opts.ensureFresh,
  });

  if (!cost.ok) {
    return {
      ok: false,
      hard: true,
      soft: Boolean(cost.soft),
      code: cost.code || "BUDGET_EXCEEDED",
      message: cost.message || "cost hard cap",
      cost,
      auth: cost.auth,
      blockedBy: "cost",
    };
  }

  let seat = { ok: true, skipped: true, enabled: false };
  if (seatsEnabled(cfg)) {
    try {
      seat = await checkSeatBudget(cfg, opts.peer || opts.seatPeer || opts.from || null, {
        estimateUsd: opts.estimateUsd || 0,
        estimateTokens: opts.estimateTokens || 0,
      });
    } catch (err) {
      seat = {
        ok: cfg?.cost?.strict === true ? false : true,
        error: err?.message || String(err),
        check_error: true,
      };
      if (cfg?.cost?.strict === true || cfg?.seats?.strict === true) {
        return {
          ok: false,
          hard: true,
          code: "SEAT_CHECK_ERROR",
          message: seat.error,
          cost,
          seat,
          auth: cost.auth,
          blockedBy: "seat",
        };
      }
    }
    if (!seat.ok) {
      return {
        ok: false,
        hard: true,
        soft: Boolean(seat.soft),
        code: "SEAT_BUDGET_EXCEEDED",
        message: seat.message || "seat hard cap",
        cost,
        seat,
        auth: cost.auth,
        blockedBy: "seat",
      };
    }
  }

  return {
    ok: true,
    soft: Boolean(cost.soft) || Boolean(seat.soft),
    cost,
    seat,
    auth: cost.auth,
    message:
      cost.soft || seat.soft
        ? [cost.message, seat.message].filter(Boolean).join("; ") || "soft budget warning"
        : undefined,
  };
}

export default { dualBudgetPreflight };
