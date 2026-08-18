/**
 * Quota preflight for write/exec tools in authorize().
 * Soft band may escalate to hard refuse in the same call when near the cap.
 */
import {
  isWriteTool,
  estimateWriteDelta,
  preflightWriteQuota,
} from "./workspace-quota.mjs";
import { maybeEmitQuotaSoft, maybeEmitQuotaHard } from "./quota-soft-warn.mjs";
import {
  shouldEscalateSoftToHard,
  escalateSoftResult,
} from "./quota-soft-escalate.mjs";
import { recordQuotaEscalateEvent } from "../jobs/receipt-metrics.mjs";

export async function authorizeQuotaPreflight(name, args = {}, ctx = {}) {
  if (!isWriteTool(name)) {
    return { ok: true, skipped: true };
  }
  const cfg = ctx.cfg || {};
  if (cfg.workspace?.quota?.enabled === false) {
    return { ok: true, skipped: true, disabled: true };
  }
  const root =
    ctx.workingDir ||
    args.cwd ||
    args.workingDir ||
    cfg.workspace?.root ||
    process.cwd();
  const delta = estimateWriteDelta(name, args);
  let r = await preflightWriteQuota(root, cfg, delta);

  if (r.ok && r.soft && shouldEscalateSoftToHard(r, cfg)) {
    r = escalateSoftResult(r, { tool: name, root });
  }

  if (!r.ok) {
    const hard = maybeEmitQuotaHard(r, { tool: name, root }, ctx.hubs || {});
    recordEscalate(ctx, {
      hard: true,
      escalatedFromSoft: Boolean(r.escalatedFromSoft),
      code: r.code || "WORKSPACE_QUOTA_EXCEEDED",
    });
    try {
      const { recordHardBlock } = await import("../agent/quota-hard-circuit.mjs");
      const trip = recordHardBlock(ctx.job || ctx.collector, {
        cfg,
        code: r.code || "WORKSPACE_QUOTA_EXCEEDED",
        escalatedFromSoft: Boolean(r.escalatedFromSoft),
      });
      if (trip?.tripped) {
        return {
          ok: false,
          reason: "QUOTA_HARD_CIRCUIT",
          message: `workspace quota hard circuit (${trip.hardBlocks}/${trip.limit})`,
          quota: r,
          hard,
          circuit: trip,
          escalatedFromSoft: Boolean(r.escalatedFromSoft),
        };
      }
    } catch {
      /* circuit optional */
    }
    return {
      ok: false,
      reason: r.code || "WORKSPACE_QUOTA_EXCEEDED",
      message: r.message || "workspace quota exceeded",
      quota: r,
      hard,
      escalatedFromSoft: Boolean(r.escalatedFromSoft),
    };
  }
  const warn = maybeEmitQuotaSoft(r, { tool: name, root }, ctx.hubs || {});
  if (r.soft) {
    recordEscalate(ctx, {
      soft: true,
      phase: "soft_warn",
      code: r.code || "WORKSPACE_QUOTA_SOFT",
    });
  }
  return { ok: true, soft: r.soft, quota: r, warn };
}

function recordEscalate(ctx, event) {
  const job = ctx?.job || ctx?.collector || ctx?.metrics;
  if (!job) return;
  try {
    recordQuotaEscalateEvent(job, event);
  } catch {
    /* optional */
  }
}

export default { authorizeQuotaPreflight };
