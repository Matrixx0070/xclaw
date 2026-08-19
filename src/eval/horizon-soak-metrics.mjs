const state = { soak_block_total: 0 };

export function incSoakBlock(n = 1) {
  state.soak_block_total += n;
  return state.soak_block_total;
}

export function getSoakBlockTotal() {
  return state.soak_block_total;
}

export function resetSoakMetrics() {
  state.soak_block_total = 0;
}

export function renderSoakMetrics() {
  return `xclaw_horizon_soak_block_total ${state.soak_block_total}\n`;
}

export default {
  incSoakBlock,
  getSoakBlockTotal,
  resetSoakMetrics,
  renderSoakMetrics,
};
