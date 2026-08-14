/**
 * Cache routing keys for provider prompt caches.
 *
 * Goals:
 *  1. Sticky routing (xAI x-grok-conv-id / prompt_cache_key) within one goal
 *  2. Isolation when model, profile, or tool pack changes (avoid false affinity)
 *  3. Stable, ASCII, length-safe header values
 *  4. Optional namespace for multi-tenant / multi-user gateways
 *
 * Key shape (default):
 *   xclaw:{ns}:{profile}:{modelFamily}:{session}
 *
 * session is the durable transcript/session id when present; otherwise a
 * short-lived run id. Model family is coarsened (grok-4.5, claude-sonnet, …)
 * so minor alias changes do not always bust routing — full model is optional.
 */
import crypto from "node:crypto";

const MAX_HEADER_LEN = 128;

/**
 * Coarsen model id for cache partitioning.
 * Same family → can share routing; different family → different key.
 */
export function modelCacheFamily(model = "") {
  const m = String(model || "").toLowerCase().trim();
  if (!m) return "default";
  // xAI
  if (m.includes("grok-4.6")) return "grok-4.6";
  if (m.includes("grok-4.5")) return "grok-4.5";
  if (m.includes("grok-4.3")) return "grok-4.3";
  if (m.includes("multi-agent")) return "grok-multi-agent";
  if (m.includes("grok-build") || m.includes("grok-code")) return "grok-build";
  if (m.includes("grok-4.20")) return "grok-4.20";
  if (m.includes("grok")) return "grok";
  // Anthropic
  if (m.includes("opus")) return "claude-opus";
  if (m.includes("sonnet")) return "claude-sonnet";
  if (m.includes("haiku")) return "claude-haiku";
  if (m.includes("fable")) return "claude-fable";
  if (m.includes("claude")) return "claude";
  // OpenAI-ish
  if (m.includes("gpt-5")) return "gpt-5";
  if (m.includes("gpt-4")) return "gpt-4";
  if (m.includes("o3") || m.includes("o4")) return "openai-reason";
  // Fallback: first 24 safe chars
  return m.replace(/[^a-z0-9._-]+/g, "-").slice(0, 24) || "model";
}

/**
 * Sanitize a key segment for HTTP headers / JSON bodies.
 */
export function sanitizeKeyPart(s, max = 48) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/[^a-zA-Z0-9._:@+-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, max) || "x";
}

/**
 * Short stable hash for long session ids.
 */
export function shortHash(s, len = 12) {
  return crypto.createHash("sha256").update(String(s || "")).digest("hex").slice(0, len);
}

/**
 * Build optimized cache routing key.
 *
 * @param {object} opts
 * @param {string} [opts.sessionId] durable session / transcript id
 * @param {string} [opts.runId] ephemeral run id if no session
 * @param {string} [opts.model]
 * @param {string} [opts.provider]
 * @param {string} [opts.profile] lab|dev|prod
 * @param {string} [opts.namespace] tenant / user partition
 * @param {string} [opts.toolPack] optional allowTools fingerprint
 * @param {boolean} [opts.includeModel=true]
 * @param {boolean} [opts.includeProfile=true]
 * @param {boolean} [opts.hashLongSession=true] hash session if > 40 chars
 * @returns {string}
 */
export function buildCacheRoutingKey(opts = {}) {
  const parts = ["xclaw"];

  const ns = opts.namespace || opts.userId || opts.tenantId || null;
  if (ns) parts.push(sanitizeKeyPart(ns, 24));

  if (opts.includeProfile !== false) {
    const profile = opts.profile || opts.cfg?.profile || process.env.XCLAW_PROFILE || "default";
    parts.push(sanitizeKeyPart(profile, 16));
  }

  if (opts.includeModel !== false) {
    parts.push(sanitizeKeyPart(modelCacheFamily(opts.model), 24));
  }

  if (opts.toolPack) {
    parts.push("tp" + shortHash(opts.toolPack, 8));
  }

  const sessionRaw =
    opts.sessionId ||
    opts.conversationId ||
    opts.convId ||
    opts.runId ||
    opts.sessionKey ||
    "";
  let sessionPart = String(sessionRaw || "").trim();
  if (!sessionPart) {
    sessionPart = "run-" + shortHash(String(Date.now()) + Math.random(), 10);
  } else if (opts.hashLongSession !== false && sessionPart.length > 40) {
    sessionPart = shortHash(sessionPart, 16);
  } else {
    sessionPart = sanitizeKeyPart(sessionPart, 48);
  }
  parts.push(sessionPart);

  let key = parts.join(":");
  if (key.length > MAX_HEADER_LEN) {
    // Keep prefix identity + hash the rest
    const head = parts.slice(0, Math.max(1, parts.length - 1)).join(":");
    const tail = shortHash(key, 16);
    key = sanitizeKeyPart(head, MAX_HEADER_LEN - 17) + ":" + tail;
  }
  return key.slice(0, MAX_HEADER_LEN);
}

/**
 * Optional body field for Responses API (xAI / OpenAI-style).
 */
export function buildPromptCacheKey(opts = {}) {
  return buildCacheRoutingKey(opts);
}

/**
 * Headers for Chat Completions providers that use sticky cache routing.
 */
export function buildProviderCacheHeaders(opts = {}) {
  const key = buildCacheRoutingKey(opts);
  const provider = String(opts.provider || "").toLowerCase();
  const base = String(opts.baseUrl || "").toLowerCase();
  const isXai =
    provider === "xai" ||
    provider === "x.ai" ||
    base.includes("api.x.ai") ||
    base.includes("x.ai");

  if (!isXai && opts.force !== true) {
    // Still return key for logging; headers empty for non-xAI
    return { headers: {}, key };
  }
  return {
    headers: { "x-grok-conv-id": key },
    key,
  };
}

/**
 * Fingerprint allowTools list for optional toolPack segment.
 */
export function toolPackFingerprint(allowTools) {
  if (!allowTools) return null;
  if (!Array.isArray(allowTools)) return shortHash(String(allowTools), 8);
  const names = [...allowTools].map(String).sort();
  if (!names.length) return null;
  return names.join(",");
}

export default {
  modelCacheFamily,
  sanitizeKeyPart,
  shortHash,
  buildCacheRoutingKey,
  buildPromptCacheKey,
  buildProviderCacheHeaders,
  toolPackFingerprint,
};
