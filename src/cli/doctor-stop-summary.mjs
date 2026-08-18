/**
 * One-glance kill-switch posture for doctor --json.
 */
export function buildStopSummary(checks = []) {
  const byId = Object.fromEntries(
    (checks || []).filter((c) => c && c.id).map((c) => [c.id, c])
  );
  const health = byId["ops.stop_health"];
  const hmac = byId["gateway.stopHmac"];
  const last = byId["security.killSwitch.lastDrain"];
  const ks = byId["security.killSwitch"];
  const auth = byId["gateway.stopAuth"];
  const statuses = [health, hmac, last, ks, auth]
    .filter(Boolean)
    .map((c) => c.status);
  let status = "ok";
  if (statuses.includes("error")) status = "error";
  else if (statuses.includes("warn")) status = "warn";
  return {
    status,
    health: health?.detail || health?.message || null,
    hmac: hmac?.message || null,
    auth: auth?.message || null,
    lastDrain: last?.detail || last?.message || null,
    killSwitch: ks?.message || null,
  };
}

export function attachStopSummary(report) {
  if (!report) return report;
  report.summary = report.summary || {};
  report.summary.stop = buildStopSummary(report.checks || []);
  return report;
}

export default { buildStopSummary, attachStopSummary };
