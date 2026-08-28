/**
 * Doctor: quota escalate rate from last-smoke.json.
 *
 * This row used to substitute `{ jobs: 0, hardBlocks: 0, hardBlockRate: 0 }`
 * whenever the smoke artifact was absent and then print
 * `hardBlockRate=0.000 jobs=0 hard=0` — a measurement it had never taken,
 * beside a warn. And the artifact is absent on every real host: nothing in
 * production writes reports/autonomy/last-smoke.json (the only writer is
 * scripts/autonomy-smoke-offline.mjs, run from the ship pack, into a checkout
 * that is thrown away). So the fabricated zero was the permanent reading.
 *
 * A rate over an empty denominator is undefined, not 0.000. Report the absence
 * instead, at the level the doctor already uses for artifacts that were never
 * created; keep warn and error for a rate actually measured over jobs that
 * actually ran.
 */
import { compareAutonomySmoke } from "../eval/autonomy-smoke-compare.mjs";
import { smokeArtifactPath } from "../eval/autonomy-smoke-artifact.mjs";

export function pushQuotaEscalateChecks(push, root = process.cwd(), opts = {}) {
  const c = compareAutonomySmoke(root);
  const maxRate = Number(opts.maxHardBlockRate ?? process.env.XCLAW_MAX_HARD_BLOCK_RATE ?? 0.25);

  if (!c.current) {
    push(
      "ops.quota_escalate",
      "info",
      `no autonomy smoke artifact (${smokeArtifactPath(root)}) — nothing to measure`,
      { maxRate, reason: c.reason, noData: true }
    );
    return { status: "info", quotaEscalate: null };
  }

  const q = c.current.quotaEscalate || {};
  const jobs = Number(q.jobs) || 0;
  if (!jobs) {
    push("ops.quota_escalate", "info", "autonomy smoke recorded no jobs — nothing to measure", {
      ...q,
      maxRate,
      reason: c.reason,
      noData: true,
    });
    return { status: "info", quotaEscalate: q };
  }

  const rate = Number(q.hardBlockRate) || 0;
  const status = rate > maxRate ? "error" : "ok";
  push(
    "ops.quota_escalate",
    status,
    `quota hardBlockRate=${rate.toFixed(3)} jobs=${jobs} hard=${q.hardBlocks || 0}`,
    { ...q, maxRate, reason: c.reason }
  );
  return { status, quotaEscalate: q };
}

export default { pushQuotaEscalateChecks };
