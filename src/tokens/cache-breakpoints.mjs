/**
 * Cache-control breakpoints for prompt prefixes.
 *
 * Anthropic: content blocks with { cache_control: { type: "ephemeral" } }
 * OpenAI / xAI: no explicit API — we still split logically and keep a single
 *   stable system string (order = implicit breakpoint boundaries).
 *
 * Breakpoint policy (default):
 *   1. After base system identity
 *   2. After project memory
 *   3. After skills (last static block — strongest cache mark)
 */

/**
 * Split context sections produced by buildContextSections into parts.
 * Expected headings: "## Project memory", "## Available skills", "## Skill details"
 */
export function splitContextSections(contextSections = "") {
  const text = String(contextSections || "").trim();
  if (!text) return { memory: "", skills: "" };

  const skillsIdx = text.search(/^## Available skills/m);
  const detailsIdx = text.search(/^## Skill details/m);
  const memoryIdx = text.search(/^## Project memory/m);

  let memory = "";
  let skills = "";

  if (memoryIdx >= 0) {
    const end =
      skillsIdx >= 0 ? skillsIdx : detailsIdx >= 0 ? detailsIdx : text.length;
    memory = text.slice(memoryIdx, end).trim();
  }

  if (skillsIdx >= 0) {
    skills = text.slice(skillsIdx).trim();
  } else if (detailsIdx >= 0 && memoryIdx < 0) {
    skills = text.slice(detailsIdx).trim();
  } else if (!memory) {
    skills = text;
  }

  return { memory, skills };
}

/**
 * Build ordered static blocks for caching.
 * @returns {Array<{ id: string, text: string, cache: boolean }>}
 */
export function buildCacheBlocks({
  basePrompt = "",
  contextSections = "",
  dynamicNotes = [],
  breakpoints = null,
} = {}) {
  const { memory, skills } = splitContextSections(contextSections);
  const bp = breakpoints || {
    afterBase: true,
    afterMemory: true,
    afterSkills: true,
  };

  const blocks = [];
  if (basePrompt && String(basePrompt).trim()) {
    blocks.push({
      id: "base",
      text: String(basePrompt).trim(),
      cache: bp.afterBase !== false,
    });
  }
  if (memory) {
    blocks.push({
      id: "memory",
      text: memory,
      cache: bp.afterMemory !== false,
    });
  }
  if (skills) {
    blocks.push({
      id: "skills",
      text: skills,
      cache: bp.afterSkills !== false,
    });
  }
  for (let i = 0; i < (dynamicNotes || []).length; i++) {
    const n = dynamicNotes[i];
    if (n && String(n).trim()) {
      blocks.push({
        id: `dynamic_${i}`,
        text: String(n).trim(),
        cache: false, // never cache dynamic notes in the static prefix
      });
    }
  }
  return blocks;
}

/**
 * Flatten blocks to a single system string (OpenAI / xAI / default).
 */
export function blocksToSystemText(blocks) {
  return (blocks || [])
    .map((b) => b.text)
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Anthropic-style content parts with cache_control on marked boundaries.
 * Only the *last* cacheable block needs a breakpoint for max prefix cache;
 * we mark each configured boundary for flexibility.
 */
export function blocksToAnthropicContent(blocks, { ttl = "ephemeral" } = {}) {
  const parts = [];
  for (const b of blocks || []) {
    if (!b.text) continue;
    const part = { type: "text", text: b.text };
    if (b.cache) {
      part.cache_control = { type: ttl === "ephemeral" ? "ephemeral" : ttl };
    }
    parts.push(part);
  }
  return parts;
}

/**
 * OpenAI-compatible multipart system content (array of text parts).
 * Most OpenAI-compatible APIs accept string only; array is used when
 * cfg.tokens.cacheBreakpoints.multipart === true.
 * No cache_control field (not standard on OpenAI chat).
 */
export function blocksToOpenAIContent(blocks) {
  return (blocks || [])
    .filter((b) => b.text)
    .map((b) => ({ type: "text", text: b.text }));
}

/**
 * Detect whether to emit Anthropic cache_control.
 */
export function shouldUseAnthropicCacheControl(cfg = {}, hints = {}) {
  const mode = cfg.tokens?.cacheBreakpoints?.mode;
  if (mode === "anthropic") return true;
  if (mode === "none" || mode === "off") return false;
  if (mode === "openai" || mode === "text") return false;

  const provider = String(
    hints.provider || cfg.tokens?.provider || cfg.agent?.provider || ""
  ).toLowerCase();
  const base = String(hints.baseUrl || cfg.agent?.baseUrl || "").toLowerCase();
  const model = String(hints.model || cfg.agent?.model || "").toLowerCase();

  if (provider.includes("anthropic") || provider.includes("claude")) return true;
  if (base.includes("anthropic")) return true;
  if (model.includes("claude")) return true;
  return false;
}

/**
 * Build the system message object for the provider.
 *
 * @returns {{ message: object, meta: object }}
 */
export function buildSystemMessageWithBreakpoints({
  basePrompt,
  contextSections,
  dynamicNotes = [],
  cfg = {},
  model,
  baseUrl,
  provider,
} = {}) {
  const bpCfg = cfg.tokens?.cacheBreakpoints || {};
  const enabled = bpCfg.enabled !== false;

  const blocks = buildCacheBlocks({
    basePrompt,
    contextSections,
    dynamicNotes,
    breakpoints: bpCfg.breakpoints,
  });

  const meta = {
    enabled,
    blockIds: blocks.map((b) => b.id),
    cacheMarks: blocks.filter((b) => b.cache).map((b) => b.id),
    mode: "text",
  };

  if (!enabled) {
    return {
      message: { role: "system", content: blocksToSystemText(blocks) },
      meta,
    };
  }

  if (shouldUseAnthropicCacheControl(cfg, { model, baseUrl, provider })) {
    meta.mode = "anthropic_cache_control";
    return {
      message: {
        role: "system",
        content: blocksToAnthropicContent(blocks, {
          ttl: bpCfg.ttl || "ephemeral",
        }),
      },
      meta,
    };
  }

  if (bpCfg.multipart === true) {
    meta.mode = "multipart_text";
    return {
      message: {
        role: "system",
        content: blocksToOpenAIContent(blocks),
      },
      meta,
    };
  }

  // Default: single stable string (best for xAI / OpenAI automatic caching)
  meta.mode = "text";
  return {
    message: { role: "system", content: blocksToSystemText(blocks) },
    meta,
  };
}
