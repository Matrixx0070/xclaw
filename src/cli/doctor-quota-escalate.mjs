/**
 * Doctor: quota escalate rate from last-smoke.json.
 */
import { compareAutonomySmoke } from "../eval/autonomy-smoke-compare.mjs";

export function pushQuotaEscalateChecks(push, root = process.cwd(), opts = {}) {
  const c = compareAutonomySmoke(root);
  const q = c.current?.quotaEscalate || { jobs: 0, hardBlocks: 0, hardBlockRate: 0 };
  const maxRate = Number(opts.maxHardBlockRate ?? process.env.XCLAW_MAX_HARD_BLOCK_RATE ?? 0.25);
  const rate = Number(q.hardBlockRate) || 0;
  let status = "ok";
  if (!c.current) status = "warn";
  else if (q.jobs > 0 && rate > maxRate) status = "error";
  push(
    "ops.quota_escalate",
    status,
    `quota hardBlockRate=${rate.toFixed(3)} jobs=${q.jobs || 0} hard=${q.hardBlocks || 0}`,
    { ...q, maxRate, reason: c.reason }
  );
  return { status, quotaEscalate: q };
}

export default { pushQuotaEscalateChecks };
