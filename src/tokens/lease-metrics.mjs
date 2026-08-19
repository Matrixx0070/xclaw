/**
 * In-process lease metrics counters.
 */
const counters = {
  lease_acquire_total: 0,
  lease_held_total: 0,
  lease_renew_total: 0,
  lease_release_total: 0,
  lease_backend_error_total: 0,
};

export function incLeaseMetric(name, n = 1) {
  if (counters[name] == null) counters[name] = 0;
  counters[name] += n;
  return counters[name];
}

export function getLeaseMetrics() {
  return { ...counters };
}

export function resetLeaseMetrics() {
  for (const k of Object.keys(counters)) counters[k] = 0;
}

export default { incLeaseMetric, getLeaseMetrics, resetLeaseMetrics };
