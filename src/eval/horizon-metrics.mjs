/**
 * Long-horizon autonomy pass counters.
 */
const state = { horizon_pass_total: 0, horizon_fail_total: 0 };

export function incHorizonPass(n = 1) {
  state.horizon_pass_total += n;
  return state.horizon_pass_total;
}

export function incHorizonFail(n = 1) {
  state.horizon_fail_total += n;
  return state.horizon_fail_total;
}

export function getHorizonPassTotal() {
  return state.horizon_pass_total;
}

export function resetHorizonMetrics() {
  state.horizon_pass_total = 0;
  state.horizon_fail_total = 0;
}

export function renderHorizonMetrics() {
  return (
    `xclaw_autonomy_horizon_pass_total ${state.horizon_pass_total}\n` +
    `xclaw_autonomy_horizon_fail_total ${state.horizon_fail_total}\n`
  );
}

export default {
  incHorizonPass,
  incHorizonFail,
  getHorizonPassTotal,
  resetHorizonMetrics,
  renderHorizonMetrics,
};
