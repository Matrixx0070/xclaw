/**
 * Hallucination canary counters.
 */
const state = { ungrounded_total: 0 };

export function incCanaryUngrounded(n = 1) {
  state.ungrounded_total += n;
  return state.ungrounded_total;
}

export function getCanaryUngroundedTotal() {
  return state.ungrounded_total;
}

export function resetCanaryMetrics() {
  state.ungrounded_total = 0;
}

export function renderCanaryMetrics() {
  return `xclaw_canary_ungrounded_total ${state.ungrounded_total}\n`;
}

export default {
  incCanaryUngrounded,
  getCanaryUngroundedTotal,
  resetCanaryMetrics,
  renderCanaryMetrics,
};
