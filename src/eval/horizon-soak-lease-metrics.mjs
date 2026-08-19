const state = { soak_lease_denied_total: 0 };

export function incSoakLeaseDenied(n = 1) {
  state.soak_lease_denied_total += n;
  return state.soak_lease_denied_total;
}

export function getSoakLeaseDeniedTotal() {
  return state.soak_lease_denied_total;
}

export function resetSoakLeaseMetrics() {
  state.soak_lease_denied_total = 0;
}

export function renderSoakLeaseMetrics() {
  return `xclaw_horizon_soak_lease_denied_total ${state.soak_lease_denied_total}\n`;
}

export default {
  incSoakLeaseDenied,
  getSoakLeaseDeniedTotal,
  resetSoakLeaseMetrics,
  renderSoakLeaseMetrics,
};
