/**
 * Combined doctor ops inserts (auth, receipt, stop, smoke) — one hunk.
 */
export async function pushDoctorOpsBundle(push, cfg = {}, opts = {}) {
  try {
    const { pushKillSwitchChecks } = await import("./doctor-kill-switch.mjs");
    await pushKillSwitchChecks(push);
  } catch (e) {
    try {
      const { listActiveSessions } = await import("../agent/session-control.mjs");
      const n = listActiveSessions().length;
      push("security.killSwitch", "ok", `session kill-switch ready (activeSessions=${n})`);
    } catch (e2) {
      push("security.killSwitch", "warn", e.message || e2.message || String(e));
    }
  }

  try {
    const { pushAuthRefreshChecks } = await import("./doctor-auth-refresh.mjs");
    await pushAuthRefreshChecks(push, cfg);
  } catch (e) {
    push("ops.auth_refresh", "warn", e.message || String(e));
  }

  try {
    const { pushReceiptMetricsChecks } = await import("./doctor-receipt-metrics.mjs");
    await pushReceiptMetricsChecks(push, cfg);
  } catch (e) {
    push("ops.receipt_metrics", "warn", e.message || String(e));
  }

  try {
    const { pushStopRouteChecks } = await import("./doctor-stop-route.mjs");
    await pushStopRouteChecks(push, cfg);
  } catch (e) {
    push("gateway.stopRoute", "warn", e.message || String(e));
  }

  try {
    const { pushStopAuthChecks } = await import("./doctor-stop-auth.mjs");
    pushStopAuthChecks(push, cfg);
  } catch (e) {
    push("gateway.stopAuth", "warn", e.message || String(e));
  }

  try {
    const { pushQuotaEscalateChecks } = await import("./doctor-quota-escalate.mjs");
    pushQuotaEscalateChecks(push, opts.root || process.cwd());
  } catch (e) {
    push("ops.quota_escalate", "warn", e.message || String(e));
  }

  try {
    const { pushSmokeCompareChecks } = await import("./doctor-smoke-compare.mjs");
    pushSmokeCompareChecks(push, opts.root || process.cwd());
  } catch (e) {
    push("ops.smoke_compare", "warn", e.message || String(e));
  }
}

export default { pushDoctorOpsBundle };
