/**
 * Adaptive encoding selection for XClaw token counting.
 *
 * Chooses:
 *  - encoding name (o200k_base, cl100k_base, …)
 *  - counting strategy (tiktoken vs heuristic ratios)
 *  - chars/token defaults tuned per family
 */

/** @typedef {{ encoding: string, family: string, charsPerToken: number, codeCharsPerToken: number, overheadPerMessage: number, replyPrimer: number }} EncodingProfile */

/** @type {Record<string, EncodingProfile>} */
export const ENCODING_PROFILES = {
  o200k_base: {
    encoding: "o200k_base",
    family: "openai-o200k",
    charsPerToken: 4,
    codeCharsPerToken: 2.5,
    overheadPerMessage: 4,
    replyPrimer: 3,
  },
  cl100k_base: {
    encoding: "cl100k_base",
    family: "openai-cl100k",
    charsPerToken: 4,
    codeCharsPerToken: 2.5,
    overheadPerMessage: 4,
    replyPrimer: 3,
  },
  p50k_base: {
    encoding: "p50k_base",
    family: "openai-p50k",
    charsPerToken: 4,
    codeCharsPerToken: 2.5,
    overheadPerMessage: 4,
    replyPrimer: 3,
  },
  // Approximate profiles when only heuristics are available
  "anthropic-approx": {
    encoding: "anthropic-approx",
    family: "anthropic",
    charsPerToken: 3.5,
    codeCharsPerToken: 2.2,
    overheadPerMessage: 5,
    replyPrimer: 3,
  },
  "gemini-approx": {
    encoding: "gemini-approx",
    family: "google",
    charsPerToken: 4,
    codeCharsPerToken: 2.5,
    overheadPerMessage: 4,
    replyPrimer: 3,
  },
  generic: {
    encoding: "generic",
    family: "generic",
    charsPerToken: 4,
    codeCharsPerToken: 2.5,
    overheadPerMessage: 4,
    replyPrimer: 3,
  },
};

/**
 * Infer provider/family + encoding from model id and optional baseUrl.
 * @param {string} [model]
 * @param {{ baseUrl?: string, provider?: string }} [hints]
 * @returns {{ encoding: string, family: string, provider: string, confidence: string }}
 */
export function inferEncoding(model = "", hints = {}) {
  const m = String(model || "").toLowerCase().trim();
  const url = String(hints.baseUrl || "").toLowerCase();
  const explicit = String(hints.provider || "").toLowerCase();

  // Explicit provider wins
  if (explicit === "anthropic" || explicit === "claude") {
    return { encoding: "anthropic-approx", family: "anthropic", provider: "anthropic", confidence: "high" };
  }
  if (explicit === "google" || explicit === "gemini") {
    return { encoding: "gemini-approx", family: "google", provider: "google", confidence: "high" };
  }
  if (explicit === "openai") {
    return { ...inferOpenAIEncoding(m), provider: "openai", confidence: "high" };
  }

  // URL hints
  if (url.includes("anthropic")) {
    return { encoding: "anthropic-approx", family: "anthropic", provider: "anthropic", confidence: "medium" };
  }
  if (url.includes("googleapis") || url.includes("gemini")) {
    return { encoding: "gemini-approx", family: "google", provider: "google", confidence: "medium" };
  }

  // Model name patterns — Claude
  if (m.includes("claude") || m.startsWith("anthropic")) {
    return { encoding: "anthropic-approx", family: "anthropic", provider: "anthropic", confidence: "high" };
  }

  // Gemini
  if (m.includes("gemini") || m.includes("palm") || m.startsWith("models/")) {
    return { encoding: "gemini-approx", family: "google", provider: "google", confidence: "high" };
  }

  // OpenAI-style
  if (
    m.includes("gpt") ||
    m.includes("o1") ||
    m.includes("o3") ||
    m.includes("o4") ||
    m.includes("davinci") ||
    m.includes("text-embedding") ||
    m.includes("chatgpt")
  ) {
    return { ...inferOpenAIEncoding(m), provider: "openai", confidence: "high" };
  }

  // Local / unknown models on OpenAI-compatible endpoints → o200k as modern default
  if (url.includes("openai.com") || url.includes("azure") || !url) {
    return {
      encoding: "o200k_base",
      family: "openai-o200k",
      provider: "openai-compatible",
      confidence: "low",
    };
  }

  return {
    encoding: "generic",
    family: "generic",
    provider: "unknown",
    confidence: "low",
  };
}

function inferOpenAIEncoding(m) {
  // Newest multimodal / 4o / 4.1 / o-series
  if (
    m.includes("gpt-4o") ||
    m.includes("gpt-4.1") ||
    m.includes("chatgpt-4o") ||
    /(?:^|[^a-z])o1(?:[^a-z]|$)/.test(m) ||
    /(?:^|[^a-z])o3(?:[^a-z]|$)/.test(m) ||
    /(?:^|[^a-z])o4(?:[^a-z]|$)/.test(m)
  ) {
    return { encoding: "o200k_base", family: "openai-o200k" };
  }

  // GPT-4 classic / 3.5 / turbo
  if (
    m.includes("gpt-4") ||
    m.includes("gpt-3.5") ||
    m.includes("turbo") ||
    m.includes("text-embedding-3") ||
    m.includes("text-embedding-ada")
  ) {
    return { encoding: "cl100k_base", family: "openai-cl100k" };
  }

  // Legacy
  if (m.includes("davinci") || m.includes("curie") || m.includes("codex")) {
    return { encoding: "p50k_base", family: "openai-p50k" };
  }

  // Default modern OpenAI
  return { encoding: "o200k_base", family: "openai-o200k" };
}

/**
 * Full adaptive selection: inference + profile + overrides from config.
 * @returns {EncodingProfile & { provider: string, confidence: string, source: string }}
 */
export function selectEncoding({ model, baseUrl, provider, tokensCfg } = {}) {
  const inferred = inferEncoding(model, { baseUrl, provider });
  const cfg = tokensCfg || {};

  // Config override for encoding name
  let encoding = cfg.encoding || inferred.encoding;
  if (cfg.encoding) {
    // keep family from profile if known
  }

  const base =
    ENCODING_PROFILES[encoding] ||
    ENCODING_PROFILES[inferred.encoding] ||
    ENCODING_PROFILES.generic;

  return {
    ...base,
    encoding,
    // allow numeric overrides
    charsPerToken: cfg.proseCharsPerToken ?? cfg.charsPerToken ?? base.charsPerToken,
    codeCharsPerToken: cfg.codeCharsPerToken ?? base.codeCharsPerToken,
    overheadPerMessage: cfg.overheadPerMessage ?? base.overheadPerMessage,
    replyPrimer: cfg.replyPrimer ?? base.replyPrimer,
    provider: inferred.provider,
    confidence: cfg.encoding ? "config" : inferred.confidence,
    source: cfg.encoding ? "config" : "inferred",
    model: model || null,
  };
}

/**
 * Whether this encoding can be realized by local tiktoken-like libs.
 */
export function isTiktokenEncoding(encoding) {
  return encoding === "o200k_base" || encoding === "cl100k_base" || encoding === "p50k_base";
}
