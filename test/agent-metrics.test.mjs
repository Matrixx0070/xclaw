import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  recordAgentTurnMetrics,
  recordSuggestionTapMetric,
  getAgentMetricsSnapshot,
  resetAgentMetrics,
  renderAgentPrometheus,
} from "../src/agent/agent-metrics.mjs";

describe("agent-metrics", () => {
  beforeEach(() => resetAgentMetrics());

  it("records tool statuses and suggestions", () => {
    recordAgentTurnMetrics({
      toolTrace: [
        { name: "xclaw_bash", nameNormalized: "shell", status: "fail", outcome: { kind: "test_fail" } },
        { name: "xclaw_file_write", nameNormalized: "write", status: "ok", outcome: { kind: "success" } },
      ],
      suggestions: [{ id: "1" }, { id: "2" }],
      closure: { closed: false, reason: "failed", confidence: 0.9 },
      suppressed: false,
    });
    const s = getAgentMetricsSnapshot();
    assert.equal(s.turns, 1);
    assert.equal(s.toolStatus.fail, 1);
    assert.equal(s.toolStatus.ok, 1);
    assert.equal(s.toolOutcome.test_fail, 1);
    assert.equal(s.suggestionsShown, 2);
    assert.equal(s.closureOpen, 1);
    assert.ok(s.lastTurn);
  });

  it("tracks taps and suppress", () => {
    recordAgentTurnMetrics({
      toolTrace: [],
      suggestions: [],
      closure: { closed: true, reason: "action_done", confidence: 0.8 },
      suppressed: true,
    });
    recordSuggestionTapMetric();
    const s = getAgentMetricsSnapshot();
    assert.equal(s.suggestionsSuppressed, 1);
    assert.equal(s.closureClosed, 1);
    assert.equal(s.suggestionsTapped, 1);
  });

  it("renders prometheus lines", () => {
    recordAgentTurnMetrics({
      toolTrace: [{ status: "ok", outcome: { kind: "success" }, nameNormalized: "shell" }],
      suggestions: [{ id: "a" }],
      closure: { closed: false, reason: "open", confidence: 0.4 },
    });
    const text = renderAgentPrometheus();
    assert.match(text, /xclaw_agent_turns_total 1/);
    assert.match(text, /xclaw_tool_status_total\{status="ok"\} 1/);
    assert.match(text, /xclaw_suggestions_shown_total 1/);
    assert.match(text, /xclaw_turn_closure_total\{state="open"\} 1/);
  });
});
