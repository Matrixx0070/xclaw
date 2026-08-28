/**
 * Translate one runSecurityAudit finding into a doctor row.
 *
 * This layer was three lines inside runDoctor and got all three wrong:
 *
 *  1. It prefixed every id with `security.` unconditionally, but three of the
 *     audit's ids already carry that prefix (security.autoApprove,
 *     security.systemRunPlan, security.requirePinnedExe). The live report
 *     therefore printed `security.security.autoApprove` — and the doubling was
 *     not merely cosmetic: it made the row DISTINCT from the doctor's own
 *     inline `security.autoApprove` push, so one config setting produced two
 *     warn rows with divergent advice and nothing noticed. A test named
 *     doctor-no-duplicate-probes existed and could not see it, because it pins
 *     probe FUNCTIONS reached from runDoctor, not the row ids they emit.
 *
 *  2. Its level map read `if (level === "ok") push(...,"ok") else push(...,"ok")`
 *     — a byte-identical if/else, which is how audit `info` came out green.
 *     The doctor has supported `info` since 3.313.0 (cron.ledger,
 *     ops.smoke_compare, ops.quota_escalate all use it, and the text renderer
 *     prints INFO), and info exists precisely for "nothing to report either
 *     way". Reporting it as `ok` asserts a verdict the audit did not give: a
 *     localhost host with no gateway token got a green row reading "No
 *     XCLAW_GATEWAY_TOKEN / gateway.token".
 *
 *  3. It appended the finding's `fix` for warn/error only, so the remedy text
 *     was dropped from exactly the advisory rows that exist to carry one. The
 *     rule here is uniform instead of per-level — one branch fewer, and no
 *     level can silently lose information again.
 *
 * Pure and separately testable because the call site is not: the loop lives in
 * runDoctor, which loads real config and makes live HTTP. The wiring back to
 * runDoctor is pinned by reading it as text (test/doctor-audit-row.test.mjs).
 */

/** Levels the doctor renders. Anything else is a defect in the audit, not a
 *  finding to render green — it stays an error, as the original else did. */
const KNOWN_LEVELS = new Set(["ok", "info", "warn", "error"]);

/** Row id for a finding: prefix with the group, but never twice. */
export function auditRowId(id) {
  const s = String(id ?? "").trim();
  if (!s) return "security.audit";
  return s === "security" || s.startsWith("security.") ? s : `security.${s}`;
}

/** Doctor status for an audit level. Identity for every level the doctor can
 *  render; unknown levels surface as errors rather than disappearing. */
export function auditRowStatus(level) {
  return KNOWN_LEVELS.has(level) ? level : "error";
}

/** Message for a finding: the remedy rides along at every level that has one. */
export function auditRowMessage(finding = {}) {
  const message = finding.message ?? "";
  return finding.fix ? `${message} — ${finding.fix}` : message;
}

export function auditRow(finding = {}) {
  return {
    id: auditRowId(finding.id),
    status: auditRowStatus(finding.level),
    message: auditRowMessage(finding),
  };
}

export default { auditRow, auditRowId, auditRowStatus, auditRowMessage };
