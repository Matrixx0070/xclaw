/**
 * LLM compaction summarizer (Mandate-2 slice B2) — wires the dormant
 * summarizeFn hook in compaction.mjs to a cheap routed model.
 *
 * Model resolution: cfg.tokens.compaction.model → role-router draft role →
 * null (extractive fallback — today's behavior, zero regression). Hard
 * bounds: pre-digested input ≤ ~12K chars, ≤600 output tokens, 20s timeout,
 * any error → null (foldAgedTurns falls back extractively).
 */
import { buildExtractiveSummary } from "./compaction.mjs";
import { resolveRoleMap } from "../providers/role-router.mjs";
import { createProviderForRef } from "../providers/failover-router.mjs";

const INPUT_MAX_CHARS = 12_000;
const OUTPUT_MAX_TOKENS = 600;
const TIMEOUT_MS = 20_000;

export function resolveSummarizerModel(cfg = {}) {
  if (cfg.tokens?.compaction?.llm === false) return null;
  return cfg.tokens?.compaction?.model || resolveRoleMap(cfg).draft || null;
}

/**
 * Returns an async (agedMessages) => string|null summarizer, or null when no
 * cheap model is configured (callers pass summarizeFn: null → extractive).
 */
export function createLlmSummarizer(cfg = {}, opts = {}) {
  const modelRef = resolveSummarizerModel(cfg);
  if (!modelRef) return null;

  return async function summarize(aged) {
    try {
      // Pre-digest deterministically so the model sees a bounded, already
      // structured account instead of raw transcript soup.
      const digest = buildExtractiveSummary(aged, { maxChars: INPUT_MAX_CHARS });
      const { provider } = await createProviderForRef(cfg, modelRef, {});
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const completion = await provider.chat({
          messages: [
            {
              role: "system",
              content:
                "You compress agent-conversation state. Produce a terse state note (facts, decisions, file paths, commands run, errors, open threads). If the input contains [xclaw-compaction] blocks, MERGE them into one note — most recent facts win. No preamble, no advice. Stay under 500 words.",
            },
            { role: "user", content: digest },
          ],
          max_tokens: OUTPUT_MAX_TOKENS,
          signal: controller.signal,
        });
        const text =
          typeof completion?.message?.content === "string"
            ? completion.message.content.trim()
            : null;
        return text || null;
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      opts.onEvent?.({
        type: "cache",
        phase: "compaction_llm_error",
        message: String(err?.message || err).slice(0, 200),
      });
      return null; // extractive fallback
    }
  };
}
