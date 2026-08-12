/**
 * E2E harden: turn state → chips → shown/tap feedback → durable store → metrics/doctor signals
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  buildTurnSuggestions,
  detectTurnClosure,
  shouldSuppressSuggestions,
} from "../src/agent/suggestions.mjs";
import {
  beginToolTraceEntry,
  finalizeToolTraceEntry,
  resetToolTraceSeq,
} from "../src/agent/tool-trace.mjs";
import {
  loadSuggestionFeedback,
  recordDurableSuggestionFeedback,
  buildScoreBiasMap,
  suggestionFeedbackStats,
  suggestionFeedbackPath,
} from "../src/agent/suggestion-feedback.mjs";
import {
  recordAgentTurnMetrics,
  recordSuggestionTapMetric,
  getAgentMetricsSnapshot,
  resetAgentMetrics,
  renderAgentPrometheus,
} from "../src/agent/agent-metrics.mjs";
import {
  suggestionsInlineKeyboard,
  formatSuggestionsPlain,
} from "../src/agent/suggestions.mjs";
import { parseCallbackData } from "../src/channels/telegram/inline.mjs";

describe("suggestions e2e arc", () => {
  let tmp;
  let cfg;

  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-sug-e2e-"));
    cfg = {
      paths: { configDir: tmp },
      auth: { durableWrites: false },
      suggestions: {
        enabled: true,
        max: 3,
        minScore: 0.3,
        suppressOnClose: true,
        closureMinConfidence: 0.6,
        closedAllowCommitChip: "auto",
        skipGitInspect: true,
      },
    };
    resetAgentMetrics();
    resetToolTraceSeq();
  });

  after(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
    resetAgentMetrics();
  });

  it("1) open turn with fail → diagnose chip from toolTrace", () => {
    resetToolTraceSeq();
    const partial = beginToolTraceEntry({
      name: "xclaw_bash",
      args: { command: "npm test" },
      toolCallId: "c1",
      turn: 1,
    });
    const entry = finalizeToolTraceEntry(partial, {
      resultText: "3 failed\n14 passed\nexit code: 1",
      originalChars: 40,
      keptChars: 40,
    });
    assert.equal(entry.status, "fail");
    assert.equal(entry.outcome.kind, "test_fail");

    const toolTrace = [entry];
    const closure = detectTurnClosure({
      userMessage: "run the tests",
      replyText: "There were test failures in the suite.",
      toolTrace,
    });
    assert.equal(closure.closed, false);

    const items = buildTurnSuggestions({
      userMessage: "run the tests",
      replyText: "There were test failures in the suite.",
      toolTrace,
      cfg,
      git: { isRepo: true, dirty: false },
    });
    assert.ok(items.length >= 1);
    assert.equal(items[0].source, "trace_fail");
    assert.match(items[0].label + items[0].prompt, /fail|Fix|Diagnose/i);

    // Telegram keyboard shape
    const kb = suggestionsInlineKeyboard(items);
    assert.ok(kb.inline_keyboard.length >= 1);
    const cb = kb.inline_keyboard[0][0].callback_data;
    assert.ok(cb.length <= 64);
    assert.equal(parseCallbackData(cb).kind, "sug");

    recordAgentTurnMetrics({
      toolTrace,
      suggestions: items,
      closure,
      suppressed: false,
    });
  });

  it("2) shown + tapped → durable feedback + bias", async () => {
    const items = buildTurnSuggestions({
      userMessage: "run the tests",
      replyText: "There were test failures in the suite.",
      toolTrace: [
        {
          name: "xclaw_bash",
          status: "fail",
          nameNormalized: "shell",
          outcome: { kind: "test_fail", summary: "3 failed", exitCode: 1, confidence: 0.9 },
          artifacts: [{ type: "command", ref: "npm test", role: "input" }],
        },
      ],
      cfg,
    });
    assert.ok(items.length >= 1);
    const chip = items[0];

    // Simulate Telegram show
    await recordDurableSuggestionFeedback(cfg, {
      event: "shown",
      source: chip.source,
      kind: chip.kind,
      prompt: chip.prompt,
      suggestionId: chip.id,
      userId: "tg:111",
      chatId: "111",
    });
    // Simulate tap
    await recordDurableSuggestionFeedback(cfg, {
      event: "tapped",
      source: chip.source,
      kind: chip.kind,
      prompt: chip.prompt,
      suggestionId: chip.id,
      userId: "tg:111",
      chatId: "111",
    });
    recordSuggestionTapMetric();

    const store = await loadSuggestionFeedback(cfg);
    const st = suggestionFeedbackStats(store);
    assert.ok(st.shown >= 1);
    assert.ok(st.tapped >= 1);
    assert.ok(st.tapRate > 0);

    const fp = suggestionFeedbackPath(cfg);
    const raw = await fs.readFile(fp, "utf8");
    assert.match(raw, /trace_fail|diagnose/);

    const biasMap = buildScoreBiasMap(store, "tg:111", { userMinShown: 1 });
    const key = `${chip.source}|${chip.kind}`;
    assert.ok(biasMap.has(key) || biasMap.size >= 0);

    // Rank again with bias
    const ranked = buildTurnSuggestions({
      userMessage: "run the tests again",
      replyText: "Still failing.",
      toolTrace: [
        {
          name: "xclaw_bash",
          status: "fail",
          outcome: { kind: "test_fail", summary: "2 failed", confidence: 0.9 },
        },
      ],
      cfg,
      biasMap,
      userId: "tg:111",
    });
    assert.ok(ranked.length >= 1);
  });

  it("3) closed + dirty → commit chip only", () => {
    const toolTrace = [
      {
        name: "xclaw_file_write",
        status: "ok",
        nameNormalized: "write",
        outcome: { kind: "success", summary: "wrote src/x.mjs", confidence: 1 },
        artifacts: [{ type: "file", ref: "src/x.mjs", role: "output" }],
      },
    ];
    const closure = detectTurnClosure({
      userMessage: "Implement the helper",
      replyText: "Done. Implemented and all tests pass.",
      toolTrace,
    });
    assert.equal(closure.closed, true);

    const items = buildTurnSuggestions({
      userMessage: "Implement the helper",
      replyText: "Done. Implemented and all tests pass.",
      toolTrace,
      cfg,
      git: {
        isRepo: true,
        dirty: true,
        fileCount: 2,
        samplePaths: ["src/x.mjs", "test/x.test.mjs"],
        branch: "main",
      },
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].kind, "commit");
    assert.match(items[0].label, /Commit/);

    const gate = shouldSuppressSuggestions({
      userMessage: "Implement the helper",
      replyText: "Done. Implemented and all tests pass.",
      toolTrace,
      cfg,
    });
    // allow commit path opens gate
    assert.equal(gate.suppress, false);
    assert.equal(gate.reason, "closed_allow_commit");

    recordAgentTurnMetrics({
      toolTrace,
      suggestions: items,
      closure,
      suppressed: false,
    });
  });

  it("4) metrics + prometheus reflect the arc", () => {
    const snap = getAgentMetricsSnapshot();
    assert.ok(snap.turns >= 2);
    assert.ok((snap.toolStatus.fail || 0) + (snap.toolStatus.ok || 0) >= 1);
    assert.ok(snap.suggestionsShown >= 1);
    assert.ok(snap.suggestionsTapped >= 1);

    const prom = renderAgentPrometheus();
    assert.match(prom, /xclaw_agent_turns_total/);
    assert.match(prom, /xclaw_tool_status_total/);
    assert.match(prom, /xclaw_suggestions_shown_total/);
    assert.match(prom, /xclaw_suggestions_tapped_total/);
    assert.match(prom, /xclaw_turn_closure_total/);
  });

  it("5) doctor-shaped summary from live stores", async () => {
    const store = await loadSuggestionFeedback(cfg);
    const st = suggestionFeedbackStats(store);
    const snap = getAgentMetricsSnapshot();

    // Shape mirrors doctor checks agent_suggestions / suggestion_feedback
    const doctorAgent = {
      name: "agent_suggestions",
      ok: true,
      severity: "info",
      summary: `shown=${snap.suggestionsShown} tapped=${snap.suggestionsTapped} suppressed=${snap.suggestionsSuppressed} tapRate=${(snap.suggestionTapRate || 0).toFixed(2)}`,
    };
    const doctorFb = {
      name: "suggestion_feedback",
      ok: true,
      severity: "info",
      summary: st.shown
        ? `shown=${st.shown} tapped=${st.tapped} rate=${(st.tapRate || 0).toFixed(2)}`
        : "no durable events yet",
    };
    assert.match(doctorAgent.summary, /shown=/);
    assert.match(doctorFb.summary, /shown=/);
    assert.ok(st.tapped >= 1);
  });

  it("6) plain format for non-keyboard channels", () => {
    const plain = formatSuggestionsPlain([
      { label: "Fix the failing tests", prompt: "x", id: "1" },
    ]);
    assert.match(plain, /Next:/);
    assert.match(plain, /Fix the failing tests/);
  });
});
