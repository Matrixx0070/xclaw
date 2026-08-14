import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { foldAgedTurns } from "../src/tokens/compaction.mjs";
import { createLlmSummarizer, resolveSummarizerModel } from "../src/tokens/summarize.mjs";

function msgs(n, prefix = "m") {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 ? "assistant" : "user",
    content: `${prefix}${i} — did a thing with file src/f${i}.mjs`,
  }));
}

describe("hierarchical context (B2)", () => {
  it("summarizeFn drives the fold and reports llm:true", async () => {
    const { messages, report } = await foldAgedTurns(msgs(20), {
      keepRecent: 4,
      summarizeFn: async () => "LLM STATE NOTE",
    });
    assert.equal(report.folded, true);
    assert.equal(report.llm, true);
    const note = messages.find((m) => m._compaction);
    assert.ok(note.content.includes("LLM STATE NOTE"));
  });

  it("summarizer failure falls back extractively", async () => {
    const { messages, report } = await foldAgedTurns(msgs(20), {
      keepRecent: 4,
      summarizeFn: async () => {
        throw new Error("boom");
      },
    });
    assert.equal(report.folded, true);
    assert.equal(report.llm, false);
    assert.ok(messages.some((m) => m._compaction));
  });

  it("fold-of-folds: a second fold ABSORBS the first — exactly one note survives", async () => {
    const first = await foldAgedTurns(msgs(20, "a"), { keepRecent: 4 });
    assert.equal(first.messages.filter((m) => m._compaction).length, 1);
    // grow the conversation past the threshold again
    const grown = [...first.messages, ...msgs(16, "b")];
    const second = await foldAgedTurns(grown, { keepRecent: 4 });
    assert.equal(second.report.folded, true);
    assert.equal(
      second.messages.filter((m) => m._compaction).length,
      1,
      "prior compaction notes must merge, not stack"
    );
  });

  it("a prior note inside the recent window is promoted, not duplicated", async () => {
    const base = msgs(14, "x");
    // plant a compaction note near the END (inside keepRecent window)
    base.splice(12, 0, { role: "user", content: "[xclaw-compaction]\nold note", _compaction: true });
    const { messages, report } = await foldAgedTurns(base, { keepRecent: 6, minAgeToFold: 4 });
    assert.equal(report.folded, true);
    assert.equal(messages.filter((m) => m._compaction).length, 1);
  });

  it("model resolution: explicit → draft role → null; llm:false kills it", () => {
    assert.equal(
      resolveSummarizerModel({ tokens: { compaction: { model: "x/y" } } }),
      "x/y"
    );
    assert.equal(
      resolveSummarizerModel({ router: { roles: { draft: "cheap/d" } } }),
      "cheap/d"
    );
    assert.equal(resolveSummarizerModel({}), null);
    assert.equal(
      resolveSummarizerModel({ tokens: { compaction: { llm: false, model: "x/y" } } }),
      null
    );
    assert.equal(createLlmSummarizer({}), null);
  });
});
