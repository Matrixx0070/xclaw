/**
 * Prompt caching strategy helpers for XClaw
 *
 * Goals:
 *  1. Keep a stable, large *prefix* (system + tools description) so providers
 *     that support prompt caching (xAI, Anthropic, OpenAI) can reuse KV/cache.
 *  2. Put volatile content (user turn, tool results) *after* the stable prefix.
 *  3. Report cache hit rates from usage.cached_tokens.
 *  4. Optional: skip re-sending huge skill bodies every turn by summarizing
 *     after turn 1 when cfg.tokens.cacheSkillsAfterTurn is set.
 *
 * xAI exposes usage.prompt_tokens_details.cached_tokens when cache hits occur.
 */

/**
 * Build system message content optimized for caching.
 * Order matters: static identity → memory → skills → dynamic notes.
 */
export function buildCacheableSystemPrompt({
  basePrompt,
  contextSections = "",
  dynamicNotes = [],
}) {
  const parts = [];
  if (basePrompt) parts.push(String(basePrompt).trim());
  if (contextSections) parts.push(String(contextSections).trim());
  // Dynamic notes go last so they don't bust the prefix cache
  for (const n of dynamicNotes) {
    if (n && String(n).trim()) parts.push(String(n).trim());
  }
  return parts.filter(Boolean).join("\n\n");
}

/**
 * Compute cache efficiency from a usage snapshot / turn entry.
 */
export function cacheStatsFromUsage(usageLike) {
  if (!usageLike) return null;
  const prompt = usageLike.promptTokens ?? usageLike.prompt_tokens ?? 0;
  const cached =
    usageLike.cachedTokens ??
    usageLike.prompt_tokens_details?.cached_tokens ??
    usageLike.cached_tokens ??
    0;
  if (!prompt || prompt <= 0) {
    return {
      promptTokens: prompt || 0,
      cachedTokens: cached || 0,
      uncachedTokens: prompt || 0,
      hitRate: 0,
    };
  }
  const hitRate = Math.min(1, Math.max(0, cached / prompt));
  return {
    promptTokens: prompt,
    cachedTokens: cached,
    uncachedTokens: Math.max(0, prompt - cached),
    hitRate,
    hitRatePct: Number((hitRate * 100).toFixed(1)),
  };
}

/**
 * Aggregate cache stats across tracker turns.
 */
export function aggregateCacheStats(turns = []) {
  let prompt = 0;
  let cached = 0;
  for (const t of turns) {
    if (t.estimated) continue;
    prompt += t.promptTokens || 0;
    cached += t.cachedTokens || 0;
  }
  if (!prompt) {
    return {
      promptTokens: 0,
      cachedTokens: 0,
      uncachedTokens: 0,
      hitRate: 0,
      hitRatePct: 0,
      turnsWithCache: 0,
    };
  }
  const turnsWithCache = turns.filter((t) => (t.cachedTokens || 0) > 0).length;
  const hitRate = cached / prompt;
  return {
    promptTokens: prompt,
    cachedTokens: cached,
    uncachedTokens: Math.max(0, prompt - cached),
    hitRate,
    hitRatePct: Number((hitRate * 100).toFixed(1)),
    turnsWithCache,
  };
}

/**
 * Strategy tips for the current provider/model (returned in events / cost API).
 */
export function cachingRecommendations({ provider, model, cache } = {}) {
  const tips = [];
  const p = String(provider || "").toLowerCase();
  const m = String(model || "").toLowerCase();

  if (p.includes("xai") || m.includes("grok")) {
    tips.push("xAI caches stable prompt prefixes — keep system + tools identical across turns");
    tips.push("Large repeated system text (skills/memory) improves cached_tokens on later turns");
  }
  if (p.includes("anthropic") || m.includes("claude")) {
    tips.push("Anthropic cache_control breakpoints work best with a large static system block first");
  }
  if (p.includes("openai") || m.includes("gpt")) {
    tips.push("OpenAI automatic prompt caching favors identical prefixes ≥ ~1024 tokens");
  }

  tips.push("Do not put timestamps or random ids in the system prompt");
  tips.push("Append tool results as new messages; avoid rewriting earlier system content");
  tips.push("Run tokens.probeOnStart once; avoid re-probing every turn");

  if (cache && cache.hitRate < 0.1 && cache.promptTokens > 500) {
    tips.push("Low cache hit rate — check that system prompt is byte-stable across turns");
  }

  return tips;
}

/**
 * Decide whether to slim skill details after first turn (keeps index only).
 * Returns { systemContent, slimmed }.
 */
export function maybeSlimSkillsForCache({
  turnIndex,
  fullSystem,
  slimSystem,
  enabled,
  afterTurn = 1,
}) {
  if (!enabled) return { systemContent: fullSystem, slimmed: false };
  if (turnIndex < afterTurn) return { systemContent: fullSystem, slimmed: false };
  if (!slimSystem) return { systemContent: fullSystem, slimmed: false };
  return { systemContent: slimSystem, slimmed: true };
}
