/**
 * Block high-risk tools until receipt/evidence is present.
 */
const DEFAULT_HIGH_RISK = new Set([
  "xclaw_bash",
  "bash",
  "xclaw_browser_tab",
  "browser_tab",
  "xclaw_file_write",
  "file_write",
]);

export function highRiskTools(cfg = {}) {
  const extra = cfg?.agent?.highRiskTools || cfg?.security?.highRiskTools || [];
  return new Set([...DEFAULT_HIGH_RISK, ...extra.map(String)]);
}

export function toolRequiresReceipt(name, cfg = {}) {
  return highRiskTools(cfg).has(String(name || ""));
}

export function guardHighRiskReceipt(name, job = {}, cfg = {}) {
  if (!toolRequiresReceipt(name, cfg)) return { ok: true, skipped: true };
  const require =
    cfg?.agent?.requireReceiptForHighRisk === true ||
    cfg?.security?.requireReceiptForHighRisk === true ||
    cfg?.profile === "prod" ||
    cfg?.profile === "strict";
  if (!require) return { ok: true, lab: true };
  const has =
    Boolean(job?.receipt) ||
    Boolean(job?.receiptCollector) ||
    (Array.isArray(job?.evidence) && job.evidence.length > 0) ||
    Boolean(job?.verify);
  if (!has) {
    return {
      ok: false,
      code: "RECEIPT_REQUIRED",
      tool: name,
      message: `high-risk tool ${name} blocked until receipt/evidence present`,
    };
  }
  return { ok: true };
}

export default { highRiskTools, toolRequiresReceipt, guardHighRiskReceipt };
