/**
 * In-process agent metrics: toolTrace statuses, suggestion show/tap, closure.
 * Exposed via Prometheus /metrics and doctor.
 */

const state = {
  toolStatus: Object.create(null), // status -> count
  toolOutcome: Object.create(null), // kind -> count
  toolFamily: Object.create(null), // family -> count
  suggestionsShown: 0,
  suggestionsTapped: 0,
  suggestionsSuppressed: 0,
  closureClosed: 0,
  closureOpen: 0,
  turns: 0,
  turnPhase: Object.create(null),
  lastTurn: null, // snapshot
};

function bump(map, key, n = 1) {
  const k = String(key || "unknown");
  map[k] = (map[k] || 0) + n;
}

/**
 * Record end of an agent turn.
 * @param {object} opts
 * @param {object[]} [opts.toolTrace]
 * @param {object[]} [opts.suggestions]
 * @param {object} [opts.closure] from detectTurnClosure
 * @param {boolean} [opts.suppressed]
 */
export function recordAgentTurnMetrics(opts = {}) {
  state.turns += 1;
  if (opts.turnPhase) bump(state.turnPhase, opts.turnPhase);
  const trace = opts.toolTrace || [];
  for (const e of trace) {
    bump(state.toolStatus, e.status || (e.blocked ? "blocked" : "unknown"));
    if (e.outcome?.kind) bump(state.toolOutcome, e.outcome.kind);
    bump(state.toolFamily, e.nameNormalized || e.name || "other");
  }
  if (opts.suppressed) state.suggestionsSuppressed += 1;
  if (opts.suggestions?.length) {
    state.suggestionsShown += opts.suggestions.length;
  }
  if (opts.closure?.closed) state.closureClosed += 1;
  else if (opts.closure) state.closureOpen += 1;

  state.lastTurn = {
    at: new Date().toISOString(),
    tools: trace.length,
    statuses: Object.fromEntries(
      trace.map((e) => [e.name || "?", e.status || "?"])
    ),
    suggestions: (opts.suggestions || []).length,
    suppressed: Boolean(opts.suppressed),
    closure: opts.closure
      ? { closed: opts.closure.closed, reason: opts.closure.reason, confidence: opts.closure.confidence }
      : null,
  };
}

export function recordSuggestionTapMetric() {
  state.suggestionsTapped += 1;
}

export function getAgentMetricsSnapshot() {
  return {
    turns: state.turns,
    turnPhase: { ...state.turnPhase },
    toolStatus: { ...state.toolStatus },
    toolOutcome: { ...state.toolOutcome },
    toolFamily: { ...state.toolFamily },
    suggestionsShown: state.suggestionsShown,
    suggestionsTapped: state.suggestionsTapped,
    suggestionsSuppressed: state.suggestionsSuppressed,
    closureClosed: state.closureClosed,
    closureOpen: state.closureOpen,
    suggestionTapRate:
      state.suggestionsShown > 0
        ? state.suggestionsTapped / state.suggestionsShown
        : 0,
    lastTurn: state.lastTurn ? { ...state.lastTurn } : null,
  };
}

/** Reset (tests) */
export function resetAgentMetrics() {
  state.toolStatus = Object.create(null);
  state.toolOutcome = Object.create(null);
  state.toolFamily = Object.create(null);
  state.suggestionsShown = 0;
  state.suggestionsTapped = 0;
  state.suggestionsSuppressed = 0;
  state.closureClosed = 0;
  state.closureOpen = 0;
  state.turns = 0;
  state.turnPhase = Object.create(null);
  state.lastTurn = null;
}

/**
 * Prometheus text lines
 */
export function renderAgentPrometheus() {
  const s = getAgentMetricsSnapshot();
  const lines = [];
  lines.push("# HELP xclaw_agent_turns_total Agent turns completed");
  lines.push("# TYPE xclaw_agent_turns_total counter");
  lines.push(`xclaw_agent_turns_total ${s.turns}`);

  lines.push("# HELP xclaw_tool_status_total Tool invocations by status");
  lines.push("# TYPE xclaw_tool_status_total counter");
  for (const [st, n] of Object.entries(s.toolStatus)) {
    lines.push(`xclaw_tool_status_total{status="${st}"} ${n}`);
  }

  lines.push("# HELP xclaw_tool_outcome_total Tool outcomes by kind");
  lines.push("# TYPE xclaw_tool_outcome_total counter");
  for (const [k, n] of Object.entries(s.toolOutcome)) {
    lines.push(`xclaw_tool_outcome_total{kind="${k}"} ${n}`);
  }

  lines.push("# HELP xclaw_suggestions_shown_total Suggestion chips shown");
  lines.push("# TYPE xclaw_suggestions_shown_total counter");
  lines.push(`xclaw_suggestions_shown_total ${s.suggestionsShown}`);

  lines.push("# HELP xclaw_suggestions_tapped_total Suggestion chips tapped");
  lines.push("# TYPE xclaw_suggestions_tapped_total counter");
  lines.push(`xclaw_suggestions_tapped_total ${s.suggestionsTapped}`);

  lines.push("# HELP xclaw_suggestions_suppressed_total Turns with chips suppressed");
  lines.push("# TYPE xclaw_suggestions_suppressed_total counter");
  lines.push(`xclaw_suggestions_suppressed_total ${s.suggestionsSuppressed}`);

  lines.push("# HELP xclaw_turn_closure_total Turns classified closed/open");
  lines.push("# TYPE xclaw_turn_closure_total counter");
  lines.push(`xclaw_turn_closure_total{state="closed"} ${s.closureClosed}`);
  lines.push(`xclaw_turn_closure_total{state="open"} ${s.closureOpen}`);

  lines.push("# HELP xclaw_suggestion_tap_rate In-process chip tap rate");
  lines.push("# TYPE xclaw_suggestion_tap_rate gauge");
  lines.push(`xclaw_suggestion_tap_rate ${s.suggestionTapRate.toFixed(4)}`);

  lines.push("# HELP xclaw_turn_phase_total Turns by phase");
  lines.push("# TYPE xclaw_turn_phase_total counter");
  for (const [ph, n] of Object.entries(s.turnPhase || {})) {
    lines.push(`xclaw_turn_phase_total{phase="${ph}"} ${n}`);
  }

  return lines.join("\n");
}

export default {
  recordAgentTurnMetrics,
  recordSuggestionTapMetric,
  getAgentMetricsSnapshot,
  resetAgentMetrics,
  renderAgentPrometheus,
};
