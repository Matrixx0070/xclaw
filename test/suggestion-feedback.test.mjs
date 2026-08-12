import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  loadSuggestionFeedback,
  recordDurableSuggestionFeedback,
  buildScoreBiasMap,
  scoreBiasFromStats,
  applySuggestionBias,
  recentPromptsFromStore,
  suggestionFeedbackStats,
  suggestionFeedbackPath,
} from "../src/agent/suggestion-feedback.mjs";
import { buildTurnSuggestions } from "../src/agent/suggestions.mjs";

describe("suggestion-feedback durable", () => {
  let tmp;
  let cfg;

  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-fb-"));
    cfg = { paths: { configDir: tmp }, auth: { durableWrites: false } };
  });

  after(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("records shown and tapped and persists", async () => {
    await recordDurableSuggestionFeedback(cfg, {
      event: "shown",
      source: "trace_fail",
      kind: "diagnose",
      prompt: "Fix the failing tests",
      userId: "u1",
    });
    await recordDurableSuggestionFeedback(cfg, {
      event: "shown",
      source: "trace_fail",
      kind: "diagnose",
      prompt: "Fix the failing tests",
      userId: "u1",
    });
    await recordDurableSuggestionFeedback(cfg, {
      event: "tapped",
      source: "trace_fail",
      kind: "diagnose",
      prompt: "Fix the failing tests",
      userId: "u1",
    });
    const store = await loadSuggestionFeedback(cfg);
    const k = "trace_fail|diagnose";
    assert.equal(store.keys[k].shown, 2);
    assert.equal(store.keys[k].tapped, 1);
    assert.equal(store.users.u1[k].tapped, 1);
    const st = suggestionFeedbackStats(store);
    assert.ok(st.tapRate > 0);
    assert.ok((await fs.readFile(suggestionFeedbackPath(cfg), "utf8")).includes("trace_fail"));
  });

  it("scoreBias favors higher CTR", () => {
    const low = scoreBiasFromStats(20, 1);
    const high = scoreBiasFromStats(20, 10);
    assert.ok(high > low);
  });

  it("bias map changes ranking", async () => {
    // More taps on generic plan over domain
    for (let i = 0; i < 5; i++) {
      await recordDurableSuggestionFeedback(cfg, {
        event: "shown",
        source: "generic",
        kind: "plan",
        prompt: "plan",
        userId: "u2",
      });
      await recordDurableSuggestionFeedback(cfg, {
        event: "tapped",
        source: "generic",
        kind: "plan",
        prompt: "plan",
        userId: "u2",
      });
    }
    const store = await loadSuggestionFeedback(cfg);
    const map = buildScoreBiasMap(store, "u2", { userMinShown: 3 });
    const biased = applySuggestionBias(0.4, "generic", "plan", map);
    assert.ok(biased > 0.4);
  });

  it("recent prompts from store", async () => {
    const store = await loadSuggestionFeedback(cfg);
    const recent = recentPromptsFromStore(store, 10);
    assert.ok(Array.isArray(recent));
  });

  it("buildTurnSuggestions accepts biasMap", () => {
    const map = new Map([["trace_fail|diagnose", 1.5]]);
    const items = buildTurnSuggestions({
      userMessage: "run tests",
      replyText: "Tests failed with 3 errors.",
      toolTrace: [
        {
          name: "xclaw_bash",
          status: "fail",
          outcome: { kind: "test_fail", summary: "3 failed", confidence: 0.9 },
        },
      ],
      biasMap: map,
      cfg: { suggestions: { max: 2, minScore: 0.2 } },
    });
    assert.ok(items.length >= 1);
    assert.ok(items[0].scoreRaw != null || items[0].score >= 0.9);
  });
});
