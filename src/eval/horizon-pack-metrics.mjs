const state = { pack_pass_total: 0 };

export function incHorizonPackPass(n = 1) {
  state.pack_pass_total += n;
  return state.pack_pass_total;
}

export function getHorizonPackPassTotal() {
  return state.pack_pass_total;
}

export function resetHorizonPackMetrics() {
  state.pack_pass_total = 0;
}

export function renderHorizonPackMetrics() {
  return `xclaw_horizon_pack_pass_total ${state.pack_pass_total}\n`;
}

export default {
  incHorizonPackPass,
  getHorizonPackPassTotal,
  resetHorizonPackMetrics,
  renderHorizonPackMetrics,
};
