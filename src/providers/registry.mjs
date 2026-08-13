/**
 * Provider registry — Phase 2.
 * Built-ins + cfg.models.providers / cfg.providers custom entries.
 * Model refs: "xai/grok-4.3", "openai/gpt-4o-mini", or bare model ids.
 */
import { resolveProviderToken } from "../auth/profiles.mjs";

export const BUILTIN_PROVIDERS = {
  xai: {
    name: "xAI",
    baseUrl: "https://api.x.ai/v1",
    api: "openai-completions",
    defaultModel: "grok-4.5",
    envKey: "XAI_API_KEY",
    models: [
      // Current flagship / coding (2026)
      { id: "grok-4.5", name: "Grok 4.5 (flagship)", context: 500000, tags: ["chat", "code", "agent"] },
      { id: "grok-4.3", name: "Grok 4.3", context: 1000000, tags: ["chat", "code"] },
      { id: "grok-build-0.1", name: "Grok Build 0.1 (agentic coding)", context: 256000, tags: ["code", "agent", "build"] },
      { id: "grok-code-fast-1", name: "Grok Code Fast 1", context: 256000, tags: ["code", "fast"] },
      // Grok 4.20 family (dated SKUs)
      { id: "grok-4.20-0309-reasoning", name: "Grok 4.20 Reasoning", context: 1000000, tags: ["reasoning"] },
      { id: "grok-4.20-0309-non-reasoning", name: "Grok 4.20 Non-reasoning", context: 1000000, tags: ["chat"] },
      { id: "grok-4.20-multi-agent-0309", name: "Grok 4.20 Multi-Agent", context: 1000000, tags: ["agent"] },
      // Grok 4 line
      { id: "grok-4", name: "Grok 4", context: 256000, tags: ["chat"] },
      { id: "grok-4-fast-reasoning", name: "Grok 4 Fast Reasoning", context: 2000000, tags: ["reasoning", "fast"] },
      { id: "grok-4-fast-non-reasoning", name: "Grok 4 Fast Non-reasoning", context: 2000000, tags: ["fast"] },
      { id: "grok-4.1-fast", name: "Grok 4.1 Fast", context: 1000000, tags: ["fast"] },
      // Legacy / vision
      { id: "grok-3", name: "Grok 3", context: 131072, tags: ["legacy"] },
      { id: "grok-3-mini", name: "Grok 3 Mini", context: 131072, tags: ["legacy", "fast"] },
      { id: "grok-2-vision-1212", name: "Grok 2 Vision", context: 32768, tags: ["vision", "legacy"] },
      { id: "grok-2-vision", name: "Grok 2 Vision (alias)", context: 32768, tags: ["vision", "legacy"] },
      { id: "grok-2-1212", name: "Grok 2", context: 131072, tags: ["legacy"] },
    ],
  },
  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    api: "openai-completions",
    defaultModel: "gpt-5.4",
    envKey: "OPENAI_API_KEY",
    models: [
      { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", context: 1050000 },
      { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", context: 1050000 },
      { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", context: 1050000 },
      { id: "gpt-5.5", name: "GPT-5.5", context: 1000000 },
      { id: "gpt-5.5-pro", name: "GPT-5.5 Pro", context: 1000000 },
      { id: "gpt-5.4", name: "GPT-5.4", context: 1050000 },
      { id: "gpt-5.4-mini", name: "GPT-5.4 mini", context: 400000 },
      { id: "gpt-5.4-nano", name: "GPT-5.4 nano", context: 400000 },
      { id: "gpt-5.4-pro", name: "GPT-5.4 Pro", context: 1050000 },
      { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", context: 1000000 },
      { id: "gpt-5.2", name: "GPT-5.2", context: 400000 },
      { id: "gpt-5.1", name: "GPT-5.1", context: 400000 },
      { id: "gpt-5", name: "GPT-5", context: 400000 },
      { id: "gpt-5-mini", name: "GPT-5 mini", context: 128000 },
      { id: "gpt-5-nano", name: "GPT-5 nano", context: 128000 },
      { id: "o3", name: "o3", context: 200000 },
      { id: "o3-pro", name: "o3-pro", context: 200000 },
      { id: "o4-mini", name: "o4-mini", context: 200000 },
      { id: "gpt-4.1", name: "GPT-4.1", context: 1047576 },
      { id: "gpt-4.1-mini", name: "GPT-4.1 mini", context: 1047576 },
      { id: "gpt-4.1-nano", name: "GPT-4.1 nano", context: 1047576 },
      { id: "gpt-4o", name: "GPT-4o", context: 128000 },
      { id: "gpt-4o-mini", name: "GPT-4o mini", context: 128000 },
    ],
  },
  anthropic: {
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    api: "anthropic-messages",
    defaultModel: "claude-sonnet-5",
    envKey: "ANTHROPIC_API_KEY",
    models: [
      { id: "claude-fable-5", name: "Claude Fable 5", context: 1000000 },
      { id: "claude-opus-5", name: "Claude Opus 5", context: 1000000 },
      { id: "claude-sonnet-5", name: "Claude Sonnet 5", context: 1000000 },
      { id: "claude-opus-4-8", name: "Claude Opus 4.8", context: 1000000 },
      { id: "claude-opus-4-7", name: "Claude Opus 4.7", context: 1000000 },
      { id: "claude-opus-4-6", name: "Claude Opus 4.6", context: 1000000 },
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", context: 1000000 },
      { id: "claude-opus-4-5-20251101", name: "Claude Opus 4.5", context: 200000 },
      { id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5", context: 200000 },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", context: 200000 },
      { id: "claude-haiku-4-5", name: "Claude Haiku 4.5 (alias)", context: 200000 },
    ],
  },
  google: {
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    api: "openai-completions",
    defaultModel: "gemini-3.6-flash",
    envKey: "GEMINI_API_KEY",
    models: [
      { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", context: 1000000 },
      { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", context: 1000000 },
      { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite", context: 1000000 },
      { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview", context: 1000000 },
      { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash-Lite", context: 1000000 },
      { id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview", context: 1000000 },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", context: 1000000 },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", context: 1000000 },
      { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash-Lite", context: 1000000 },
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", context: 1000000 },
    ],
  },
  nvidia: {
    name: "NVIDIA NIM",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    api: "openai-completions",
    defaultModel: "meta/llama-3.3-70b-instruct",
    envKey: "NVIDIA_API_KEY",
    models: [
      { id: "meta/llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
      { id: "nvidia/llama-3.1-nemotron-70b-instruct", name: "Nemotron 70B" },
      { id: "nvidia/llama-3.1-nemotron-51b-instruct", name: "Nemotron 51B" },
      { id: "nvidia/nemotron-4-340b-instruct", name: "Nemotron-4 340B" },
      { id: "deepseek-ai/deepseek-r1", name: "DeepSeek R1" },
      { id: "openai/gpt-oss-120b", name: "gpt-oss 120B" },
      { id: "qwen/qwen2.5-coder-32b-instruct", name: "Qwen2.5 Coder 32B" },
      { id: "mistralai/mistral-large-2-instruct", name: "Mistral Large 2" },
      { id: "mistralai/codestral-22b-instruct-v0.1", name: "Codestral 22B" },
      { id: "microsoft/phi-3.5-moe-instruct", name: "Phi 3.5 MoE" },
    ],
  },
  openrouter: {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    api: "openai-completions",
    defaultModel: "openai/gpt-5.4",
    envKey: "OPENROUTER_API_KEY",
    models: [
      { id: "openai/gpt-5.6-sol", name: "GPT-5.6 Sol (OR)" },
      { id: "openai/gpt-5.4", name: "GPT-5.4 (OR)" },
      { id: "openai/gpt-5.4-mini", name: "GPT-5.4 mini (OR)" },
      { id: "openai/o3", name: "o3 (OR)" },
      { id: "anthropic/claude-opus-4.8", name: "Claude Opus 4.8 (OR)" },
      { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5 (OR)" },
      { id: "google/gemini-3.6-flash", name: "Gemini 3.6 Flash (OR)" },
      { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro (OR)" },
      { id: "x-ai/grok-4.5", name: "Grok 4.5 (OR)" },
      { id: "x-ai/grok-4.3", name: "Grok 4.3 (OR)" },
      { id: "deepseek/deepseek-chat", name: "DeepSeek Chat (OR)" },
      { id: "deepseek/deepseek-r1", name: "DeepSeek R1 (OR)" },
      { id: "meta-llama/llama-4-maverick", name: "Llama 4 Maverick (OR)" },
      { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B (OR)" },
      { id: "qwen/qwen3-235b-a22b", name: "Qwen3 235B (OR)" },
      { id: "mistralai/mistral-large", name: "Mistral Large (OR)" },
    ],
  },
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    api: "openai-completions",
    defaultModel: "deepseek-chat",
    envKey: "DEEPSEEK_API_KEY",
    models: [
      { id: "deepseek-chat", name: "DeepSeek Chat (V3)", context: 128000 },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner (R1)", context: 128000 },
      { id: "deepseek-coder", name: "DeepSeek Coder", context: 128000 },
    ],
  },
  groq: {
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    api: "openai-completions",
    defaultModel: "llama-3.3-70b-versatile",
    envKey: "GROQ_API_KEY",
    models: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", context: 128000 },
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", context: 128000 },
      { id: "meta-llama/llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout", context: 128000 },
      { id: "meta-llama/llama-4-maverick-17b-128e-instruct", name: "Llama 4 Maverick", context: 128000 },
      { id: "qwen/qwen3-32b", name: "Qwen3 32B", context: 128000 },
      { id: "deepseek-r1-distill-llama-70b", name: "DeepSeek R1 Distill 70B", context: 128000 },
      { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", context: 32768 },
      { id: "gemma2-9b-it", name: "Gemma 2 9B", context: 8192 },
    ],
  },
  mistral: {
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    api: "openai-completions",
    defaultModel: "mistral-large-latest",
    envKey: "MISTRAL_API_KEY",
    models: [
      { id: "mistral-large-latest", name: "Mistral Large", context: 262144 },
      { id: "mistral-medium-latest", name: "Mistral Medium", context: 262144 },
      { id: "mistral-small-latest", name: "Mistral Small", context: 128000 },
      { id: "codestral-latest", name: "Codestral", context: 256000 },
      { id: "devstral-medium-latest", name: "Devstral Medium", context: 262144 },
      { id: "pixtral-large-latest", name: "Pixtral Large", context: 128000 },
      { id: "magistral-medium-latest", name: "Magistral Medium", context: 128000 },
      { id: "open-mistral-nemo", name: "Mistral Nemo", context: 128000 },
    ],
  },
  together: {
    name: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    api: "openai-completions",
    defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
    envKey: "TOGETHER_API_KEY",
    models: [
      { id: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo", name: "Llama 3.1 70B Turbo" },
      { id: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo", name: "Llama 3.1 8B Turbo" },
      { id: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8", name: "Llama 4 Maverick" },
      { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3" },
      { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1" },
      { id: "Qwen/Qwen2.5-72B-Instruct-Turbo", name: "Qwen 2.5 72B Turbo" },
      { id: "Qwen/Qwen3-235B-A22B-fp8-tput", name: "Qwen3 235B" },
      { id: "mistralai/Mixtral-8x7B-Instruct-v0.1", name: "Mixtral 8x7B" },
    ],
  },
  ollama: {
    name: "Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    api: "openai-completions",
    defaultModel: "llama3.3",
    envKey: "OLLAMA_API_KEY",
    models: [
      { id: "llama3.3", name: "Llama 3.3" },
      { id: "llama3.2", name: "Llama 3.2" },
      { id: "llama3.1", name: "Llama 3.1" },
      { id: "qwen2.5", name: "Qwen 2.5" },
      { id: "qwen3", name: "Qwen 3" },
      { id: "mistral", name: "Mistral" },
      { id: "mixtral", name: "Mixtral" },
      { id: "codellama", name: "Code Llama" },
      { id: "deepseek-r1", name: "DeepSeek R1" },
      { id: "gemma3", name: "Gemma 3" },
      { id: "phi4", name: "Phi-4" },
    ],
  },
  "ollama-cloud": {
    name: "Ollama Cloud",
    baseUrl: process.env.OLLAMA_CLOUD_BASE_URL || "https://ollama.com/v1",
    api: "openai-completions",
    defaultModel: "gpt-oss:120b",
    envKey: "OLLAMA_API_KEY",
    models: [
      { id: "gpt-oss:120b", name: "gpt-oss 120B (cloud)" },
      { id: "gpt-oss:20b", name: "gpt-oss 20B (cloud)" },
      { id: "deepseek-v3.1:671b-cloud", name: "DeepSeek V3.1 671B (cloud)" },
      { id: "qwen3-coder:480b-cloud", name: "Qwen3 Coder 480B (cloud)" },
      { id: "glm-4.6:cloud", name: "GLM 4.6 (cloud)" },
    ],
  },
  compatible: {
    name: "OpenAI-compatible",
    baseUrl: "http://127.0.0.1:8080/v1",
    api: "openai-completions",
    defaultModel: "local-model",
    envKey: "XCLAW_API_KEY",
    models: [{ id: "local-model", name: "Local" }],
  },
};

/** Prefix heuristics when model has no provider/ prefix */
const PREFIX_ROUTES = [
  ["grok-", "xai"],
  ["gpt-", "openai"],
  ["o1", "openai"],
  ["o3", "openai"],
  ["o4", "openai"],
  ["claude-", "anthropic"],
  ["gemini-", "google"],
  ["deepseek-", "deepseek"],
  ["llama-", "groq"],
  ["mistral-", "mistral"],
  ["codestral-", "mistral"],
  ["mixtral-", "mistral"],
  ["magistral-", "mistral"],
];

/**
 * Parse "provider/model" or bare model.
 * @returns {{ provider: string|null, model: string }}
 */
export function parseModelRef(ref) {
  if (!ref || typeof ref !== "string") return { provider: null, model: null };
  const s = ref.trim();
  // openrouter-style "openai/gpt-4o" is a model id under openrouter — only split known providers
  const slash = s.indexOf("/");
  if (slash > 0) {
    const maybe = s.slice(0, slash).toLowerCase();
    if (maybe in BUILTIN_PROVIDERS || maybe === "custom") {
      return { provider: maybe, model: s.slice(slash + 1) };
    }
  }
  return { provider: null, model: s };
}

export function inferProviderFromModel(model, cfg = {}) {
  if (!model) return process.env.XCLAW_PROVIDER || cfg.agent?.provider || "xai";
  const parsed = parseModelRef(model);
  if (parsed.provider) return parsed.provider;
  // cfg.providers.routes (documented in defaults) wins over the built-in
  // prefix table; its "default" key overrides the final fallback.
  const cfgRoutes = cfg.providers?.routes || {};
  for (const [prefix, prov] of Object.entries(cfgRoutes)) {
    if (prefix !== "default" && String(model).startsWith(prefix) && prov) return prov;
  }
  for (const [prefix, prov] of PREFIX_ROUTES) {
    if (String(model).startsWith(prefix)) return prov;
  }
  // agent.provider (explicit operator choice) still beats routes.default,
  // which in turn beats the hardcoded final fallback.
  return (
    process.env.XCLAW_PROVIDER ||
    cfg.agent?.provider ||
    cfgRoutes.default ||
    "xai"
  );
}

/**
 * Merge built-ins with cfg.models.providers and cfg.providers.
 */
export function listProviders(cfg = {}) {
  const custom =
    cfg.models?.providers ||
    cfg.providers?.catalog ||
    {};
  // cfg.providers.xai style flat
  const flat = cfg.providers || {};
  const out = {};

  for (const [id, def] of Object.entries(BUILTIN_PROVIDERS)) {
    out[id] = {
      id,
      ...def,
      baseUrl: process.env[`${id.toUpperCase()}_BASE_URL`] || def.baseUrl,
    };
  }

  for (const [id, def] of Object.entries(flat)) {
    if (id === "routes" || id === "catalog") continue;
    if (typeof def !== "object" || !def) continue;
    out[id] = {
      id,
      name: def.name || id,
      baseUrl: def.baseUrl || out[id]?.baseUrl || "http://127.0.0.1:8080/v1",
      api: def.api || "openai-completions",
      defaultModel: def.defaultModel || def.model || out[id]?.defaultModel || "local-model",
      envKey: def.envKey || out[id]?.envKey || "XCLAW_API_KEY",
      models: def.models || out[id]?.models || [],
      custom: true,
    };
  }

  for (const [id, def] of Object.entries(custom)) {
    out[id] = {
      id,
      name: def.name || id,
      baseUrl: def.baseUrl || "http://127.0.0.1:8080/v1",
      api: def.api || "openai-completions",
      defaultModel: def.defaultModel || def.model || "local-model",
      envKey: def.envKey || "XCLAW_API_KEY",
      models: Array.isArray(def.models) ? def.models : [],
      custom: true,
    };
  }

  // env overrides for compatible
  if (process.env.XCLAW_API_BASE) {
    out.compatible = {
      ...out.compatible,
      baseUrl: process.env.XCLAW_API_BASE,
      defaultModel: process.env.XCLAW_MODEL || out.compatible.defaultModel,
    };
  }

  return out;
}

export function getProvider(cfg, providerId) {
  const all = listProviders(cfg);
  return all[providerId] || all.compatible;
}

/**
 * Full route resolution used by agent loop + doctor.
 */
export async function resolveProviderRouteAsync(cfg = {}, opts = {}) {
  // Precedence: explicit call args > env (session override, repo convention:
  // env wins over file config — see XCLAW_SSRF / XCLAW_GATEWAY_HOST) > config.
  const rawModel =
    opts.model ||
    process.env.XCLAW_MODEL ||
    cfg.agent?.model ||
    null;

  const parsed = parseModelRef(rawModel);
  let provider =
    opts.provider ||
    parsed.provider ||
    process.env.XCLAW_PROVIDER ||
    cfg.agent?.provider ||
    inferProviderFromModel(parsed.model || rawModel, cfg);

  const modelOnly = parsed.model || rawModel;
  const def = getProvider(cfg, provider);
  const model = modelOnly || def.defaultModel || "gpt-4o-mini";

  // API key: auth profiles → env → cfg. cfg.agent.apiKey is the ACTIVE
  // provider's cached credential (loadConfig fills it) — applying it to a
  // different provider ships one vendor's token to another's endpoint. Only
  // use it when the resolved provider matches agent.provider, or none is set.
  const agentKeyApplies = !cfg.agent?.provider || cfg.agent.provider === provider;
  let apiKey =
    opts.apiKey ||
    (agentKeyApplies ? cfg.agent?.apiKey : null) ||
    cfg.providers?.[provider]?.apiKey ||
    process.env[def.envKey] ||
    "";

  let authSource = apiKey ? (cfg.agent?.authSource || "config/env") : null;
  if (!apiKey) {
    try {
      const tok = await resolveProviderToken(cfg, provider, {
        profileId: opts.profileId || cfg.agent?.authProfileId,
      });
      if (tok.token) {
        apiKey = tok.token;
        authSource = tok.source;
      }
    } catch {
      /* */
    }
  }

  // Fallbacks are provider-SCOPED: a missing key must never ship another
  // vendor's credential as Bearer to this provider's baseUrl (rubric R11 —
  // e.g. an Anthropic OAuth token leaking to an arbitrary custom endpoint).
  // XCLAW_API_KEY stays generic because setting it is an explicit operator
  // choice to use one key for whatever provider is configured.
  if (!apiKey) {
    const scopedEnv = {
      anthropic: ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN"],
    };
    for (const name of ["XCLAW_API_KEY", ...(scopedEnv[provider] || [])]) {
      if (process.env[name]) {
        apiKey = process.env[name];
        authSource = authSource || `env:${name}`;
        break;
      }
    }
  }

  // agent.baseUrl / apiBase are the endpoint for the AGENT'S configured
  // provider — they must not override the endpoint of a DIFFERENT provider the
  // caller selected (e.g. XCLAW_PROVIDER=ollama while agent.provider=xai; else
  // the ollama request is aimed at api.x.ai). Only honor them when the resolved
  // provider matches agent.provider, or when no provider was configured.
  const agentBaseApplies = !cfg.agent?.provider || cfg.agent.provider === provider;
  const baseUrl = (
    opts.baseUrl ||
    (agentBaseApplies ? cfg.agent?.baseUrl || cfg.agent?.apiBase : null) ||
    cfg.providers?.[provider]?.baseUrl ||
    def.baseUrl ||
    "https://api.openai.com/v1"
  ).replace(/\/$/, "");

  return {
    provider,
    model,
    modelRef: `${provider}/${model}`,
    baseUrl,
    api: def.api || "openai-completions",
    apiKey,
    hasKey: Boolean(apiKey),
    authSource,
    envKey: def.envKey,
    name: def.name || provider,
  };
}

/** Sync wrapper for existing call sites (no profile await). */
export function resolveProviderRoute(cfg = {}, opts = {}) {
  const rawModel =
    opts.model ||
    cfg.agent?.model ||
    process.env.XCLAW_MODEL ||
    null;
  const parsed = parseModelRef(rawModel);
  let provider =
    opts.provider ||
    parsed.provider ||
    cfg.agent?.provider ||
    process.env.XCLAW_PROVIDER ||
    inferProviderFromModel(parsed.model || rawModel, cfg);

  const modelOnly = parsed.model || rawModel;
  const def = getProvider(cfg, provider);
  const model = modelOnly || def.defaultModel || "gpt-4o-mini";

  const apiKey =
    opts.apiKey ||
    cfg.agent?.apiKey ||
    cfg.providers?.[provider]?.apiKey ||
    process.env[def.envKey] ||
    process.env.XCLAW_API_KEY ||
    process.env.XAI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    "";

  // agent.baseUrl / apiBase are the endpoint for the AGENT'S configured
  // provider — they must not override the endpoint of a DIFFERENT provider the
  // caller selected (e.g. XCLAW_PROVIDER=ollama while agent.provider=xai; else
  // the ollama request is aimed at api.x.ai). Only honor them when the resolved
  // provider matches agent.provider, or when no provider was configured.
  const agentBaseApplies = !cfg.agent?.provider || cfg.agent.provider === provider;
  const baseUrl = (
    opts.baseUrl ||
    (agentBaseApplies ? cfg.agent?.baseUrl || cfg.agent?.apiBase : null) ||
    cfg.providers?.[provider]?.baseUrl ||
    def.baseUrl ||
    "https://api.openai.com/v1"
  ).replace(/\/$/, "");

  return {
    provider,
    model,
    modelRef: `${provider}/${model}`,
    baseUrl,
    api: def.api || "openai-completions",
    apiKey,
    hasKey: Boolean(apiKey),
    envKey: def.envKey,
    name: def.name || provider,
  };
}

export function listModels(cfg = {}, providerFilter = null) {
  const all = listProviders(cfg);
  const rows = [];
  for (const [id, def] of Object.entries(all)) {
    if (providerFilter && id !== providerFilter) continue;
    const models = def.models?.length
      ? def.models
      : [{ id: def.defaultModel, name: def.defaultModel }];
    for (const m of models) {
      const mid = typeof m === "string" ? m : m.id;
      rows.push({
        ref: `${id}/${mid}`,
        provider: id,
        model: mid,
        name: typeof m === "string" ? m : m.name || mid,
        baseUrl: def.baseUrl,
      });
    }
  }
  return rows;
}


// Live discovery lives in discovery.mjs (cache, adapters, filters)
export {
  fetchLiveModels,
  listModelsRich,
  refreshModelCache,
  clearModelCache,
  isChatModelId,
} from "./discovery.mjs";
