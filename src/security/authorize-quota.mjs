/**
 * Quota preflight for write/exec tools in authorize().
 */
import {
  isWriteTool,
  estimateWriteDelta,
  preflightWriteQuota,
} from "./workspace-quota.mjs";
import { maybeEmitQuotaSoft } from "./quota-soft-warn.mjs";

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
  const r = await preflightWriteQuota(root, cfg, delta);
  if (!r.ok) {
    return {
      ok: false,
      reason: r.code || "WORKSPACE_QUOTA_EXCEEDED",
      message: r.message || "workspace quota exceeded",
      quota: r,
    };
  }
  const warn = maybeEmitQuotaSoft(r, { tool: name, root }, ctx.hubs || {});
  return { ok: true, soft: r.soft, quota: r, warn };
}

export default { authorizeQuotaPreflight };
