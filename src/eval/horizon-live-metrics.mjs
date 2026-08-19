const state = { live_runs_total: 0, live_fail_total: 0 };

export function incHorizonLiveRuns(n = 1) {
  state.live_runs_total += n;
  return state.live_runs_total;
}

export function incHorizonLiveFail(n = 1) {
  state.live_fail_total += n;
  return state.live_fail_total;
}

export function getHorizonLiveRunsTotal() {
  return state.live_runs_total;
}

export function resetHorizonLiveMetrics() {
  state.live_runs_total = 0;
  state.live_fail_total = 0;
}

export function renderHorizonLiveMetrics() {
  return (
    `xclaw_horizon_live_runs_total ${state.live_runs_total}\n` +
    `xclaw_horizon_live_fail_total ${state.live_fail_total}\n`
  );
}

export default {
  incHorizonLiveRuns,
  incHorizonLiveFail,
  getHorizonLiveRunsTotal,
  resetHorizonLiveMetrics,
  renderHorizonLiveMetrics,
};
