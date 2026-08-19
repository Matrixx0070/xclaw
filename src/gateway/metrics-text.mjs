/**
 * Prometheus text exposition for lease metrics.
 */
import { getLeaseMetrics } from "../tokens/lease-metrics.mjs";

export function renderPrometheusMetrics(extra = {}) {
  const m = { ...getLeaseMetrics(), ...extra };
  const lines = [
    "# HELP xclaw_lease_acquire_total Lease acquire successes",
    "# TYPE xclaw_lease_acquire_total counter",
    `xclaw_lease_acquire_total ${m.lease_acquire_total || 0}`,
    "# HELP xclaw_lease_held_total Lease held (denied) count",
    "# TYPE xclaw_lease_held_total counter",
    `xclaw_lease_held_total ${m.lease_held_total || 0}`,
    "# HELP xclaw_lease_renew_total Lease renewals",
    "# TYPE xclaw_lease_renew_total counter",
    `xclaw_lease_renew_total ${m.lease_renew_total || 0}`,
    "# HELP xclaw_lease_release_total Lease releases",
    "# TYPE xclaw_lease_release_total counter",
    `xclaw_lease_release_total ${m.lease_release_total || 0}`,
    "# HELP xclaw_lease_backend_error_total Lease backend errors",
    "# TYPE xclaw_lease_backend_error_total counter",
    `xclaw_lease_backend_error_total ${m.lease_backend_error_total || 0}`,
  ];
  return lines.join("\n") + "\n";
}

export default { renderPrometheusMetrics };
