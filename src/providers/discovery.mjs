/**
 * Live model discovery — Phase live-discovery.
 *
 * - Disk cache ~/.xclaw/cache/models/<provider>.json (TTL 1h)
 * - OpenAI-compatible GET /models
 * - xAI: prefer /v1/language-models
 * - Anthropic: x-api-key + anthropic-version
 * - Google Gemini: /v1beta/models?key=
 * - Chat filter (default); --all includes embeddings/tts/image
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { getProvider, listModels, listProviders } from "./registry.mjs";
import { resolveProviderToken } from "../auth/profiles.mjs";

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h

const NON_CHAT_RE =
  /(embed|embedding|whisper|tts|tts-|realtime|audio|dall-e|dalle|image|imagine|video|moderation|transcribe|speech|voice|omni-moderation|text-embedding|ada-002|babbage|davinci-002$)/i;

function stateDir(cfg) {
  return cfg?.paths?.configDir || process.env.XCLAW_STATE_DIR || path.join(os.homedir(), ".xclaw");
}

function cachePath(cfg, providerId, keyFp) {
  const safe = String(providerId).replace(/[^a-zA-Z0-9._-]/g, "_");
  const fp = keyFp ? keyFp.slice(0, 12) : "nokey";
  return path.join(stateDir(cfg), "cache", "models", `${safe}.${fp}.json`);
}

function keyFingerprint(apiKey) {
  if (!apiKey) return "nokey";
  return crypto.createHash("sha256").update(String(apiKey)).digest("hex").slice(0, 16);
}

export function isChatModelId(id) {
  if (!id) return false;
  return !NON_CHAT_RE.test(String(id));
}

async function resolveApiKey(cfg, providerId, def) {
  let apiKey =
    cfg.agent?.apiKey ||
    cfg.providers?.[providerId]?.apiKey ||
    process.env[def.envKey] ||
    process.env.XCLAW_API_KEY ||
    "";
  if (!apiKey) {
    try {
      const tok = await resolveProviderToken(cfg, providerId);
      if (tok.token) apiKey = tok.token;
    } catch {
      /* */
    }
  }
  return apiKey || "";
}

async function readCache(fp, ttlMs) {
  try {
    const raw = JSON.parse(await fs.readFile(fp, "utf8"));
    if (!raw?.at || !Array.isArray(raw.models)) return null;
    if (Date.now() - Date.parse(raw.at) > ttlMs) return null;
    return raw;
  } catch {
    return null;
  }
}

async function writeCache(fp, payload) {
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

function normalizeOpenAIList(body) {
  const data = Array.isArray(body?.data)
    ? body.data
    : Array.isArray(body?.models)
      ? body.models
      : Array.isArray(body)
        ? body
        : [];
  return data
    .map((m) => {
      const id = (m.id || m.name || "").replace(/^models\//, "");
      if (!id) return null;
      return {
        id,
        name: m.display_name || m.displayName || m.name || id,
        context:
          m.context_window ||
          m.contextWindow ||
          m.context ||
          m.input_token_limit ||
          m.maxInputTokens ||
          null,
        maxOutput: m.max_output_tokens || m.maxOutputTokens || null,
        ownedBy: m.owned_by || m.ownedBy || null,
        aliases: m.aliases || [],
        modalities: m.input_modalities || m.inputModalities || m.supportedGenerationMethods || null,
        created: m.created || null,
        live: true,
      };
    })
    .filter(Boolean);
}

function normalizeGeminiList(body) {
  const data = Array.isArray(body?.models) ? body.models : [];
  return data
    .map((m) => {
      let id = m.name || m.id || "";
      id = String(id).replace(/^models\//, "");
      if (!id) return null;
      const methods = m.supportedGenerationMethods || [];
      const chatty =
        methods.length === 0 ||
        methods.includes("generateContent") ||
        methods.includes("generateContentStream");
      return {
        id,
        name: m.displayName || m.display_name || id,
        context: m.inputTokenLimit || m.input_token_limit || null,
        maxOutput: m.outputTokenLimit || null,
        modalities: methods,
        chatCapable: chatty,
        live: true,
      };
    })
    .filter(Boolean);
}

/**
 * Build request for a provider.
 */
function buildDiscoveryRequest(providerId, baseUrl, apiKey) {
  const p = String(providerId).toLowerCase();
  const base = baseUrl.replace(/\/$/, "");

  // xAI richer language-models
  if (p === "xai") {
    return {
      url: `${base}/language-models`,
      headers: {
        Accept: "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      fallbackUrl: `${base}/models`,
      parser: "openai",
    };
  }

  // Anthropic native
  if (p === "anthropic") {
    // Anthropic may expose /v1/models with x-api-key
    const root = base.replace(/\/v1$/, "") + "/v1";
    return {
      url: `${root}/models`,
      headers: {
        Accept: "application/json",
        "anthropic-version": process.env.ANTHROPIC_VERSION || "2023-06-01",
        ...(apiKey
          ? { "x-api-key": apiKey, Authorization: `Bearer ${apiKey}` }
          : {}),
      },
      fallbackUrl: null,
      parser: "openai",
    };
  }

  // Google Gemini
  if (p === "google") {
    // Prefer native list; OpenAI-compat base may still support /models
    const nativeBase = "https://generativelanguage.googleapis.com/v1beta";
    const url = apiKey
      ? `${nativeBase}/models?key=${encodeURIComponent(apiKey)}&pageSize=100`
      : `${base}/models`;
    return {
      url,
      headers: {
        Accept: "application/json",
        ...(apiKey && !url.includes("key=")
          ? { "x-goog-api-key": apiKey, Authorization: `Bearer ${apiKey}` }
          : {}),
      },
      fallbackUrl: `${base}/models`,
      parser: apiKey ? "gemini" : "openai",
    };
  }

  // Default OpenAI-compatible
  return {
    url: `${base}/models`,
    headers: {
      Accept: "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    fallbackUrl: null,
    parser: "openai",
  };
}

async function fetchJson(url, headers, timeoutMs, signal) {
  const res = await fetch(url, { headers, signal });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Fetch live models for one provider (with cache).
 */
export async function fetchLiveModels(
  cfg,
  providerId,
  {
    timeoutMs = 10_000,
    ttlMs = DEFAULT_TTL_MS,
    force = false,
    includeAll = false,
  } = {}
) {
  const def = getProvider(cfg, providerId);
  const baseUrl = (def.baseUrl || "").replace(/\/$/, "");
  if (!baseUrl && providerId !== "google") {
    return { ok: false, error: "no baseUrl", models: [], provider: providerId };
  }

  const apiKey = await resolveApiKey(cfg, providerId, def);
  const fp = keyFingerprint(apiKey);
  const cacheFp = cachePath(cfg, providerId, fp);

  if (!force) {
    const cached = await readCache(cacheFp, ttlMs);
    if (cached) {
      let models = cached.models;
      if (!includeAll) models = models.filter((m) => m.chatCapable !== false && isChatModelId(m.id));
      return {
        ok: true,
        models,
        url: cached.url,
        count: models.length,
        cached: true,
        at: cached.at,
        provider: providerId,
      };
    }
  }

  const req = buildDiscoveryRequest(providerId, baseUrl || "https://generativelanguage.googleapis.com/v1beta", apiKey);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    let body;
    let usedUrl = req.url;
    try {
      body = await fetchJson(req.url, req.headers, timeoutMs, ctrl.signal);
    } catch (err) {
      if (req.fallbackUrl) {
        usedUrl = req.fallbackUrl;
        body = await fetchJson(
          req.fallbackUrl,
          {
            Accept: "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          timeoutMs,
          ctrl.signal
        );
        req.parser = "openai";
      } else {
        throw err;
      }
    }
    clearTimeout(timer);

    let models =
      req.parser === "gemini" ? normalizeGeminiList(body) : normalizeOpenAIList(body);

    // xAI language-models may nest under models
    if (providerId === "xai" && models.length === 0 && body?.models) {
      models = normalizeOpenAIList(body);
    }

    for (const m of models) {
      if (m.chatCapable == null) m.chatCapable = isChatModelId(m.id);
    }

    const payload = {
      at: new Date().toISOString(),
      url: usedUrl,
      provider: providerId,
      models,
    };
    try {
      await writeCache(cacheFp, payload);
    } catch {
      /* */
    }

    let out = models;
    if (!includeAll) out = out.filter((m) => m.chatCapable !== false && isChatModelId(m.id));

    return {
      ok: true,
      models: out,
      url: usedUrl,
      count: out.length,
      cached: false,
      at: payload.at,
      provider: providerId,
      totalDiscovered: models.length,
    };
  } catch (err) {
    clearTimeout(timer);
    // soft-fail: try stale cache
    try {
      const stale = JSON.parse(await fs.readFile(cacheFp, "utf8"));
      if (Array.isArray(stale?.models)) {
        let models = stale.models;
        if (!includeAll) models = models.filter((m) => isChatModelId(m.id));
        return {
          ok: true,
          models,
          url: stale.url,
          count: models.length,
          cached: true,
          stale: true,
          error: err.message,
          provider: providerId,
        };
      }
    } catch {
      /* */
    }
    return {
      ok: false,
      error: err.message || String(err),
      models: [],
      url: req.url,
      provider: providerId,
    };
  }
}

/**
 * Static + live merge.
 */
export async function listModelsRich(
  cfg = {},
  providerFilter = null,
  { live = false, force = false, includeAll = false, ttlMs = DEFAULT_TTL_MS } = {}
) {
  const staticRows = listModels(cfg, providerFilter);
  if (!live) {
    return { source: "static", models: staticRows.map((r) => ({ ...r, source: "static" })) };
  }

  const providers = providerFilter
    ? [providerFilter]
    : Object.keys(listProviders(cfg)).filter((id) => id !== "compatible" || providerFilter === "compatible");

  const byRef = new Map(
    staticRows.map((r) => [r.ref, { ...r, source: "static", live: false }])
  );
  const discovery = [];

  for (const pid of providers) {
    const liveRes = await fetchLiveModels(cfg, pid, { force, includeAll, ttlMs });
    discovery.push({
      provider: pid,
      ok: liveRes.ok,
      count: liveRes.count || 0,
      cached: liveRes.cached || false,
      stale: liveRes.stale || false,
      error: liveRes.error || null,
      url: liveRes.url || null,
    });
    if (!liveRes.ok && !liveRes.models?.length) continue;
    for (const m of liveRes.models || []) {
      const ref = `${pid}/${m.id}`;
      if (byRef.has(ref)) {
        const prev = byRef.get(ref);
        byRef.set(ref, {
          ...prev,
          live: true,
          source: "static+live",
          context: prev.context || m.context || null,
          aliases: m.aliases || prev.aliases,
        });
      } else {
        byRef.set(ref, {
          ref,
          provider: pid,
          model: m.id,
          name: m.name || m.id,
          baseUrl: getProvider(cfg, pid).baseUrl,
          context: m.context || null,
          live: true,
          source: "live",
          aliases: m.aliases || [],
        });
      }
    }
  }

  let models = [...byRef.values()];
  if (!includeAll) {
    models = models.filter((r) => isChatModelId(r.model));
  }

  return {
    source: "merged",
    at: new Date().toISOString(),
    models,
    discovery,
    counts: {
      total: models.length,
      static: models.filter((m) => m.source === "static").length,
      liveOnly: models.filter((m) => m.source === "live").length,
      both: models.filter((m) => m.source === "static+live").length,
    },
  };
}

/**
 * Force-refresh cache for one or all providers.
 */
export async function refreshModelCache(cfg, providerFilter = null, opts = {}) {
  const providers = providerFilter
    ? [providerFilter]
    : Object.keys(listProviders(cfg));
  const results = [];
  for (const pid of providers) {
    const r = await fetchLiveModels(cfg, pid, { ...opts, force: true });
    results.push({
      provider: pid,
      ok: r.ok,
      count: r.count || 0,
      totalDiscovered: r.totalDiscovered || r.count || 0,
      error: r.error || null,
      url: r.url || null,
    });
  }
  return { at: new Date().toISOString(), results };
}

export async function clearModelCache(cfg) {
  const dir = path.join(stateDir(cfg), "cache", "models");
  try {
    const files = await fs.readdir(dir);
    for (const f of files) {
      await fs.unlink(path.join(dir, f)).catch(() => {});
    }
    return { ok: true, cleared: files.length, dir };
  } catch {
    return { ok: true, cleared: 0, dir };
  }
}
