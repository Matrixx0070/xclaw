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
  return { ok: true, soft: r.soft, quota: r, warn };
}

export default { authorizeQuotaPreflight };
