/**
 * Composite autonomy scorecard from horizon pack + soak + SIEM + S3.
 */
import { doctorHorizon } from "../cli/doctor-horizon.mjs";

const state = { ok: 0 };

export function getScorecardOk() {
  return state.ok;
}
export function resetScorecardMetrics() {
  state.ok = 0;
}
export function renderScorecardMetrics() {
  return `xclaw_autonomy_scorecard_ok ${state.ok}\n`;
}

export async function buildAutonomyScorecard(opts = {}) {
  const d = opts.doctor || (await doctorHorizon(opts.cfg || {}));
  const hmacFail = Number(d.siemHmacFail || 0);
  const missing = Array.isArray(d.missing) ? d.missing : [];
  const packComplete = d.packComplete === true && missing.length === 0;
  const soakOk = Boolean(
    d.soakPolicy && d.soakPolicy.maxUsd > 0 && d.soakPolicy.maxTurns > 0
  );
  const ok = packComplete && hmacFail === 0 && soakOk && d.ok !== false;
  state.ok = ok ? 1 : 0;
  return {
    ok,
    packComplete,
    hmacFail,
    soakOk,
    missing,
    horizonCaseCount: d.horizonCaseCount,
    soakJobCount: d.soakJobCount || 0,
    lastS3Key: d.lastS3Key || null,
    leaseBackend: d.leaseBackend || "file",
    metrics: renderScorecardMetrics(),
    at: new Date().toISOString(),
  };
}

export default { buildAutonomyScorecard, renderScorecardMetrics };
