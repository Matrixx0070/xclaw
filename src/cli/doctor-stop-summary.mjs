/**
 * One-glance kill-switch posture for doctor --json.
 */
import { normalizeStopChannel, STOP_CHANNELS } from "./doctor-channel.mjs";

export function buildStopSummary(checks = []) {
  const byId = Object.fromEntries(
    (checks || []).filter((c) => c && c.id).map((c) => [c.id, c])
  );
  const health = byId["ops.stop_health"];
  const hmac = byId["gateway.stopHmac"];
  const last = byId["security.killSwitch.lastDrain"];
  const ks = byId["security.killSwitch"];
  const auth = byId["gateway.stopAuth"];
  const drill = byId["ops.stop_fire_drill"];
  const statuses = [health, hmac, last, ks, auth, drill]
    .filter(Boolean)
    .map((c) => c.status);
  let status = "ok";
  if (statuses.includes("error")) status = "error";
  else if (statuses.includes("warn")) status = "warn";
  const lastDetail = last?.detail || {};
  const channel = normalizeStopChannel(
    lastDetail.channel || lastDetail.drain?.channel || null
  );
  return {
    status,
    health: health?.detail || health?.message || null,
    hmac: hmac?.message || null,
    auth: auth?.message || null,
    lastDrain: lastDetail || last?.message || null,
    lastDrainChannel: channel,
    lastDrainAuthMethod:
      lastDetail.authMethod || lastDetail.drain?.authMethod || null,
    channels: STOP_CHANNELS,
    fireDrill: drill
      ? { status: drill.status, message: drill.message, detail: drill.detail || null }
      : null,
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
