/**
 * Soft → hard escalate within the same authorize() preflight.
 * When usage is in the soft band but already near the hard cap, refuse now
 * so a second tool call is not required to discover the hard limit.
 */

/**
 * @param {object} evaluation — result from preflightWriteQuota / evaluateQuota
 * @param {object} [cfg]
 * @returns {boolean}
 */
export function shouldEscalateSoftToHard(evaluation = {}, cfg = {}) {
  if (!evaluation || evaluation.hard || evaluation.ok === false) return false;
  if (!evaluation.soft) return false;

  const q = cfg.workspace?.quota || {};
  if (q.hardOnSoft === true || q.escalateSoft === true) return true;
  if (process.env.XCLAW_QUOTA_HARD_ON_SOFT === "1") return true;

  const ratio = Number(q.escalateSoftRatio);
  const escalateRatio = Number.isFinite(ratio) && ratio > 0 && ratio <= 1 ? ratio : 0.98;

  const quota = evaluation.quota || {};
  const maxBytes = Number(quota.maxBytes) || 0;
  const maxFiles = Number(quota.maxFiles) || 0;
  const bytes = Number(evaluation.bytes) || 0;
  const files = Number(evaluation.files) || 0;

  if (maxBytes > 0 && bytes >= maxBytes * escalateRatio) return true;
  if (maxFiles > 0 && files >= maxFiles * escalateRatio) return true;
  return false;
}

/**
 * Build a hard-refuse result from a soft evaluation.
 */
export function escalateSoftResult(evaluation = {}, extra = {}) {
  const reasons = [
    ...(evaluation.reasons || []),
    "soft_escalated_to_hard",
  ];
  return {
    ok: false,
    hard: true,
    soft: false,
    escalatedFromSoft: true,
    code: "WORKSPACE_QUOTA_SOFT_ESCALATED",
    message: reasons.join("; "),
    reasons,
    bytes: evaluation.bytes,
    files: evaluation.files,
    quota: evaluation.quota,
    ...extra,
  };
}

export default { shouldEscalateSoftToHard, escalateSoftResult };
