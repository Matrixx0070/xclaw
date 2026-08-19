/**
 * Quota preflight for write/exec tools in authorize().
 * Soft band may escalate to hard refuse in the same call when near the cap.
 */
import {
  isWriteTool,
  estimateWriteDelta,
  preflightWriteQuota,
  measureWorkspace,
  resolveQuota,
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
  const quotaCfg = cfg.workspace?.quota;
  // Opt-in. Without explicit workspace.quota config this preflight is inert:
  // it fails closed on a full-tree walk, so an on-by-default 512MB/50k ceiling
  // would deny every write in any workspace carrying a node_modules.
  if (!quotaCfg || quotaCfg.enabled === false) {
    return { ok: true, skipped: true, disabled: true };
  }
  const root =
    ctx.workingDir ||
    args.cwd ||
    args.workingDir ||
    cfg.workspace?.root ||
    process.cwd();
  const delta = estimateWriteDelta(name, args);
  const usage = await measureCached(root, resolveQuota(cfg), quotaCfg);
  let r = await preflightWriteQuota(root, cfg, delta, { usage });

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
        collector: ctx.collector,
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

// measureWorkspace walks the tree and stats every file (bounded by
// maxWalkEntries). Re-running that per authorize() cost seconds per tool call,
// so the measurement is memoised for a short TTL; set workspace.quota.measureTtlMs
// to 0 to always measure fresh.
const measureCache = new Map();

async function measureCached(root, quota, quotaCfg) {
  const ttl = Number(quotaCfg?.measureTtlMs ?? 1500);
  if (!(ttl > 0)) return undefined;
  const hit = measureCache.get(root);
  const now = Date.now();
  if (hit && now - hit.at < ttl) return hit.usage;
  const usage = await measureWorkspace(root, { maxWalkEntries: quota.maxWalkEntries });
  measureCache.set(root, { usage, at: now });
  if (measureCache.size > 64) {
    for (const k of measureCache.keys()) {
      if (measureCache.size <= 64) break;
      measureCache.delete(k);
    }
  }
  return usage;
}

export function _resetQuotaMeasureCache() {
  measureCache.clear();
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
