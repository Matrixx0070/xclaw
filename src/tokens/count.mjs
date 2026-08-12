/**
 * Token counting for XClaw — with explicit fallback chain
 *
 * Priority:
 *  1. Provider usage (handled by usage-tracker, post-flight)
 *  2. tiktoken encodeFn (gpt-tokenizer / js-tiktoken if installed)
 *  3. Content-aware heuristic (code denser than prose)
 *  4. Flat chars/charsPerToken
 *  5. Safe zero (never throw)
 *
 * Config (cfg.tokens):
 *   enabled, mode: "heuristic"|"tiktoken"|"auto"
 *   charsPerToken, overheadPerMessage, replyPrimer
 *   codeCharsPerToken (default 2.5), proseCharsPerToken (default 4)
 *   encoding: force encoding name
 *   provider: force provider hint
 */

import {
  selectEncoding,
  isTiktokenEncoding,
} from "./encoding.mjs";

// Re-export adaptive helpers
export { selectEncoding, isTiktokenEncoding } from "./encoding.mjs";

let tiktokenMod = null;
let tiktokenTried = false;
let tiktokenPackage = null;
let tiktokenLoadError = null;

async function tryLoadTiktoken() {
  if (tiktokenTried) return tiktokenMod;
  tiktokenTried = true;
  const errors = [];
  for (const name of ["gpt-tokenizer", "js-tiktoken"]) {
    try {
      const mod = await import(name);
      tiktokenMod = mod;
      tiktokenPackage = name;
      return mod;
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
  }
  tiktokenLoadError = errors.join("; ") || "no package found";
  return null;
}

export function encodingForModelName(model = "", hints = {}) {
  return selectEncoding({ model, ...hints }).encoding;
}

/**
 * Detect denser "code-like" text for tighter char/token ratio.
 */
export function isCodeHeavy(text) {
  if (!text || text.length < 20) return false;
  const sample = text.slice(0, 2000);
  const symbols = (sample.match(/[{}[\]();=<>/\\`]/g) || []).length;
  const lines = sample.split("\n").length;
  const avgLine = sample.length / Math.max(lines, 1);
  return symbols / sample.length > 0.08 || avgLine < 40;
}

/**
 * Heuristic token count with optional code-aware density.
 * @returns {{ tokens: number, mode: string, fallback?: string }}
 */
export function heuristicCount(text, opts = {}) {
  const s = text == null ? "" : String(text);
  if (!s) return { tokens: 0, mode: "heuristic" };

  const prose = opts.proseCharsPerToken ?? opts.charsPerToken ?? 4;
  const code = opts.codeCharsPerToken ?? 2.5;
  const charsPerToken =
    opts.adaptive !== false && isCodeHeavy(s) ? code : prose;

  // Guard against bad config
  const cpt = Number.isFinite(charsPerToken) && charsPerToken > 0 ? charsPerToken : 4;
  return {
    tokens: Math.max(1, Math.ceil(s.length / cpt)),
    mode: "heuristic",
    charsPerToken: cpt,
  };
}

/**
 * Count tokens in a plain string with full fallback chain.
 * @returns {{ tokens: number, mode: string, fallback?: string }}
 */
export function countTextTokens(text, opts = {}) {
  const s = text == null ? "" : String(text);
  if (!s) return { tokens: 0, mode: opts.mode || "heuristic" };

  const preferTiktoken = opts.mode === "tiktoken" || (opts.mode === "auto" && opts.encodeFn);

  // 1) tiktoken encodeFn
  if (preferTiktoken && typeof opts.encodeFn === "function") {
    try {
      const encoded = opts.encodeFn(s);
      const n = Array.isArray(encoded)
        ? encoded.length
        : typeof encoded?.length === "number"
          ? encoded.length
          : null;
      if (n != null && Number.isFinite(n) && n >= 0) {
        return { tokens: n, mode: "tiktoken" };
      }
      return {
        ...heuristicCount(s, opts),
        fallback: "tiktoken_invalid_result",
      };
    } catch (err) {
      return {
        ...heuristicCount(s, opts),
        fallback: `tiktoken_error:${err.message || "encode_failed"}`,
      };
    }
  }

  // 2) heuristic
  try {
    return heuristicCount(s, opts);
  } catch (err) {
    // 3) absolute last resort
    return {
      tokens: Math.ceil((s.length || 0) / 4) || 0,
      mode: "heuristic",
      fallback: `heuristic_error:${err.message || "failed"}`,
    };
  }
}

/**
 * Estimate tokens for a chat message list (OpenAI-style overhead).
 */
export function countChatTokens(messages, opts = {}) {
  const overheadPerMessage =
    Number.isFinite(opts.overheadPerMessage) && opts.overheadPerMessage >= 0
      ? opts.overheadPerMessage
      : 4;
  const replyPrimer =
    Number.isFinite(opts.replyPrimer) && opts.replyPrimer >= 0 ? opts.replyPrimer : 3;

  let total = replyPrimer;
  let contentTokens = 0;
  let framingTokens = 0;
  let mode = "heuristic";
  const fallbacks = [];

  try {
    for (const msg of messages || []) {
      framingTokens += overheadPerMessage;
      total += overheadPerMessage;

      const content = msg?.content;
      if (typeof content === "string") {
        const r = countTextTokens(content, opts);
        contentTokens += r.tokens;
        total += r.tokens;
        if (r.mode === "tiktoken") mode = "tiktoken";
        if (r.fallback) fallbacks.push(r.fallback);
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (part?.type === "text" && part.text) {
            const r = countTextTokens(part.text, opts);
            contentTokens += r.tokens;
            total += r.tokens;
            if (r.mode === "tiktoken") mode = "tiktoken";
            if (r.fallback) fallbacks.push(r.fallback);
          } else if (typeof part === "string") {
            const r = countTextTokens(part, opts);
            contentTokens += r.tokens;
            total += r.tokens;
          }
        }
      }

      if (Array.isArray(msg?.tool_calls)) {
        for (const tc of msg.tool_calls) {
          const name = tc.function?.name || "";
          const args = tc.function?.arguments || "";
          const nt = countTextTokens(name, opts);
          const at = countTextTokens(args, opts);
          const wrap = 6;
          contentTokens += nt.tokens + at.tokens;
          framingTokens += wrap;
          total += nt.tokens + at.tokens + wrap;
          if (nt.fallback) fallbacks.push(nt.fallback);
          if (at.fallback) fallbacks.push(at.fallback);
        }
      }

      if (msg?.name) {
        const r = countTextTokens(msg.name, opts);
        total += r.tokens + 1;
        framingTokens += 1;
      }
    }
  } catch (err) {
    return {
      tokens: total || 0,
      contentTokens,
      framingTokens,
      mode: "heuristic",
      messages: (messages || []).length,
      fallback: `chat_error:${err.message || "failed"}`,
    };
  }

  return {
    tokens: total,
    contentTokens,
    framingTokens,
    mode: opts.encodeFn && mode === "tiktoken" ? "tiktoken" : mode,
    messages: (messages || []).length,
    fallbacks: fallbacks.length ? fallbacks.slice(0, 5) : undefined,
  };
}

export function countToolsTokens(tools, opts = {}) {
  if (!tools?.length) return { tokens: 0, mode: opts.mode || "heuristic" };
  try {
    const s = JSON.stringify(tools);
    return countTextTokens(s, { ...opts, adaptive: true });
  } catch (err) {
    return {
      tokens: 50 * tools.length, // rough schema stub
      mode: "heuristic",
      fallback: `tools_stringify:${err.message || "failed"}`,
    };
  }
}

export function estimateRequestTokens({ messages, tools, model, cfg, baseUrl, provider } = {}) {
  const tcfg = cfg?.tokens || {};
  const profile = selectEncoding({
    model,
    baseUrl: baseUrl || cfg?.agent?.baseUrl,
    provider: provider || tcfg.provider || cfg?.agent?.provider,
    tokensCfg: tcfg,
  });

  const hasEncode = typeof tcfg._encodeFn === "function";
  const requested = tcfg.mode || "auto";
  const canTiktoken = hasEncode && isTiktokenEncoding(profile.encoding);
  const effectiveMode =
    (requested === "tiktoken" || requested === "auto") && canTiktoken
      ? "tiktoken"
      : "heuristic";

  const opts = {
    mode: effectiveMode,
    charsPerToken: profile.charsPerToken,
    proseCharsPerToken: profile.charsPerToken,
    codeCharsPerToken: profile.codeCharsPerToken,
    overheadPerMessage: profile.overheadPerMessage,
    replyPrimer: profile.replyPrimer,
    encodeFn: canTiktoken ? tcfg._encodeFn : null,
    adaptive: tcfg.adaptive !== false,
  };

  let chat;
  let toolTok;
  try {
    chat = countChatTokens(messages, opts);
    toolTok = countToolsTokens(tools, opts);
  } catch (err) {
    return {
      promptTokens: 0,
      messages: { tokens: 0, contentTokens: 0, framingTokens: 0, mode: "heuristic" },
      tools: { tokens: 0, mode: "heuristic" },
      model: model || null,
      mode: "heuristic",
      estimated: true,
      encoding: profile.encoding,
      family: profile.family,
      provider: profile.provider,
      fallback: `estimate_error:${err.message || "failed"}`,
    };
  }

  let fallback = null;
  if (!canTiktoken && (requested === "tiktoken" || requested === "auto")) {
    if (!isTiktokenEncoding(profile.encoding)) {
      fallback = `encoding_not_tiktoken:${profile.encoding}`;
    } else if (!hasEncode) {
      fallback = "tiktoken_unavailable";
    }
  }
  fallback = fallback || chat.fallback || toolTok.fallback || (chat.fallbacks && chat.fallbacks[0]) || null;

  return {
    promptTokens: (chat.tokens || 0) + (toolTok.tokens || 0),
    messages: chat,
    tools: toolTok,
    model: model || null,
    mode: effectiveMode,
    estimated: true,
    encoding: profile.encoding,
    family: profile.family,
    provider: profile.provider,
    confidence: profile.confidence,
    fallback: fallback || undefined,
    fallbacks: chat.fallbacks,
  };
}

export function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;

  const prompt = firstNumber(
    usage.prompt_tokens,
    usage.input_tokens,
    usage.promptTokens,
    usage.inputTokens
  );
  const completion = firstNumber(
    usage.completion_tokens,
    usage.output_tokens,
    usage.completionTokens,
    usage.outputTokens
  );
  let total = firstNumber(usage.total_tokens, usage.totalTokens);
  if (total == null && prompt != null && completion != null) {
    total = prompt + completion;
  }

  // Reject empty/useless usage objects
  if (prompt == null && completion == null && total == null) return null;

  // xAI: cost_in_usd_ticks — 1 USD = 10_000_000_000 ticks
  const ticks = firstNumber(
    usage.cost_in_usd_ticks,
    usage.costInUsdTicks,
    usage.cost_ticks
  );
  let costUsd = firstNumber(usage.cost_usd, usage.costUsd);
  if (costUsd == null && ticks != null) {
    costUsd = ticks / 10_000_000_000;
  }

  const reasoning = firstNumber(
    usage.completion_tokens_details?.reasoning_tokens,
    usage.output_tokens_details?.reasoning_tokens,
    usage.reasoning_tokens
  );
  const cached = firstNumber(
    usage.prompt_tokens_details?.cached_tokens,
    usage.input_tokens_details?.cached_tokens,
    usage.cached_tokens
  );

  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
    costInUsdTicks: ticks,
    costUsd: costUsd != null ? costUsd : null,
    reasoningTokens: reasoning,
    cachedTokens: cached,
    raw: usage,
    estimated: false,
    mode: "usage",
  };
}

function firstNumber(...vals) {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return null;
}

/**
 * Resolve encode function for tiktoken mode.
 * Always resolves; never throws. Falls back to heuristic.
 */
export async function resolveTokenizer(cfg = {}, model = "", hints = {}) {
  const tcfg = cfg.tokens || {};
  if (tcfg.enabled === false) {
    return { mode: "off", encodeFn: null, fallback: "disabled" };
  }

  const profile = selectEncoding({
    model,
    baseUrl: hints.baseUrl || cfg.agent?.baseUrl,
    provider: hints.provider || tcfg.provider || cfg.agent?.provider,
    tokensCfg: tcfg,
  });

  const requested = tcfg.mode || "auto";
  if (requested === "heuristic") {
    return {
      mode: "heuristic",
      encodeFn: null,
      encoding: profile.encoding,
      family: profile.family,
      provider: profile.provider,
      profile,
    };
  }

  // Non-tiktoken families cannot use local BPE libs accurately
  if (!isTiktokenEncoding(profile.encoding)) {
    return {
      mode: "heuristic",
      encodeFn: null,
      encoding: profile.encoding,
      family: profile.family,
      provider: profile.provider,
      profile,
      fallback: `encoding_not_tiktoken:${profile.encoding}`,
      detail: "Use provider count API for exact tokens with this family",
    };
  }

  if (requested === "tiktoken" || requested === "auto") {
    try {
      const mod = await tryLoadTiktoken();
      if (!mod) {
        return {
          mode: "heuristic",
          encodeFn: null,
          encoding: profile.encoding,
          family: profile.family,
          provider: profile.provider,
          profile,
          fallback: "tiktoken_unavailable",
          detail: tiktokenLoadError,
        };
      }

      const encodeFn = buildEncodeFn(mod, model, profile.encoding);
      if (!encodeFn) {
        return {
          mode: "heuristic",
          encodeFn: null,
          encoding: profile.encoding,
          family: profile.family,
          provider: profile.provider,
          profile,
          fallback: "tiktoken_no_encoder",
          package: tiktokenPackage,
        };
      }

      try {
        const probe = encodeFn("hi");
        const n = Array.isArray(probe) ? probe.length : probe?.length;
        if (n == null || !Number.isFinite(n)) {
          return {
            mode: "heuristic",
            encodeFn: null,
            encoding: profile.encoding,
            family: profile.family,
            provider: profile.provider,
            profile,
            fallback: "tiktoken_probe_failed",
            package: tiktokenPackage,
          };
        }
      } catch (err) {
        return {
          mode: "heuristic",
          encodeFn: null,
          encoding: profile.encoding,
          family: profile.family,
          provider: profile.provider,
          profile,
          fallback: `tiktoken_probe_error:${err.message}`,
          package: tiktokenPackage,
        };
      }

      return {
        mode: "tiktoken",
        encodeFn,
        encoding: profile.encoding,
        family: profile.family,
        provider: profile.provider,
        profile,
        package: tiktokenPackage,
      };
    } catch (err) {
      return {
        mode: "heuristic",
        encodeFn: null,
        encoding: profile.encoding,
        family: profile.family,
        provider: profile.provider,
        profile,
        fallback: `tiktoken_resolve_error:${err.message}`,
      };
    }
  }

  return {
    mode: "heuristic",
    encodeFn: null,
    encoding: profile.encoding,
    family: profile.family,
    provider: profile.provider,
    profile,
  };
}

function buildEncodeFn(mod, model, preferredEncoding) {
  if (!mod) return null;
  const encoding = preferredEncoding || encodingForModelName(model);

  // Prefer explicit encoding when library supports getEncoding
  if (typeof mod.getEncoding === "function") {
    try {
      const enc = mod.getEncoding(encoding);
      if (enc && typeof enc.encode === "function") {
        return (s) => enc.encode(s);
      }
    } catch {
      /* try model-based */
    }
  }
  if (typeof mod.encodingForModel === "function") {
    try {
      const enc = mod.encodingForModel(model || "gpt-4o-mini");
      if (enc && typeof enc.encode === "function") {
        return (s) => enc.encode(s);
      }
    } catch {
      /* */
    }
  }
  // gpt-tokenizer default encode (often o200k / latest)
  if (typeof mod.encode === "function") {
    return (s) => mod.encode(s);
  }
  return null;
}

export function getTiktokenStatus() {
  return {
    tried: tiktokenTried,
    loaded: Boolean(tiktokenMod),
    package: tiktokenPackage,
    error: tiktokenLoadError,
  };
}
