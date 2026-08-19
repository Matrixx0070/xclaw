const state = { soak_resume_total: 0 };

export function incSoakResume(n = 1) {
  state.soak_resume_total += n;
  return state.soak_resume_total;
}

export function getSoakResumeTotal() {
  return state.soak_resume_total;
}

export function resetSoakResumeMetrics() {
  state.soak_resume_total = 0;
}

export function renderSoakResumeMetrics() {
  return `xclaw_horizon_soak_resume_total ${state.soak_resume_total}\n`;
}

export default {
  incSoakResume,
  getSoakResumeTotal,
  resetSoakResumeMetrics,
  renderSoakResumeMetrics,
};
