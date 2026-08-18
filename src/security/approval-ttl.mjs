/**
 * Approval TTL + auto-deny policy.
 * Critical risk never silent-timeout-approves; default SLA action is deny.
 */

export const CRITICAL_NO_AUTO_APPROVE = Object.freeze([
  "critical",
  "high",
  "money",
  "destructive",
  "exec_critical",
]);

export function riskLabel(risk) {
  if (risk == null) return "unknown";
  if (typeof risk === "string") return risk.toLowerCase();
  const t = risk.tier || risk.level || risk.severity || risk.label;
  return String(t || "unknown").toLowerCase();
}

export function isCriticalRisk(risk, cfg = {}) {
  const label = riskLabel(risk);
  const extra = cfg.security?.criticalTiers || cfg.security?.noAutoApproveTiers || [];
  const set = new Set([
    ...CRITICAL_NO_AUTO_APPROVE,
    ...extra.map((x) => String(x).toLowerCase()),
  ]);
  if (set.has(label)) return true;
  const rank =
    typeof risk === "object" && risk != null
      ? Number(risk.rank ?? risk.tierRank)
      : NaN;
  if (Number.isFinite(rank) && rank >= 3) return true;
  return false;
}

export function resolveSlaAction(item = {}, cfg = {}) {
  const configured =
    item.slaAction || cfg.security?.approvalSlaAction || "deny";
  const action = String(configured).toLowerCase() === "approve" ? "approve" : "deny";
  if (action === "approve" && isCriticalRisk(item.risk, cfg)) {
    return "deny";
  }
  if (cfg.security?.approvalSlaNeverApprove === true) {
    return "deny";
  }
  return action;
}

export function approvalDeadline(slaMs = 300_000, now = Date.now()) {
  const ms = Math.max(1_000, Number(slaMs) || 300_000);
  return now + ms;
}

export function isApprovalExpired(item, now = Date.now()) {
  if (!item) return true;
  if (item.deadline != null) return now >= Number(item.deadline);
  if (item.atMs != null && item.slaMs != null) {
    return now >= Number(item.atMs) + Number(item.slaMs);
  }
  return false;
}

export function resolveExpiredApproval(item, cfg = {}) {
  const action = resolveSlaAction(item, cfg);
  const tool = item?.tool || "tool";
  if (action === "deny") {
    return {
      ok: false,
      reason: isCriticalRisk(item?.risk, cfg)
        ? "sla_timeout_critical"
        : "sla_timeout",
      message: `Approval SLA exceeded for ${tool} (auto-deny)`,
      planFingerprint: item?.plan?.fingerprint ?? null,
    };
  }
  return {
    ok: true,
    approved: true,
    mode: "sla_auto",
    reason: "sla_timeout_approve",
    message: `Approval SLA auto-approve for ${tool}`,
    planFingerprint: item?.plan?.fingerprint ?? null,
  };
}

export default {
  CRITICAL_NO_AUTO_APPROVE,
  riskLabel,
  isCriticalRisk,
  resolveSlaAction,
  approvalDeadline,
  isApprovalExpired,
  resolveExpiredApproval,
};
