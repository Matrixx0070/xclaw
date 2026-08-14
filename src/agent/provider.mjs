/**
 * OpenAI-compatible chat completions provider.
 * Works with OpenAI, local servers, and any OpenAI-compatible API.
 * Transient HTTP/network errors retry with jittered backoff.
 */
import https from "node:https";
import http from "node:http";
import {
  withBackoff,
  backoffOptsFromConfig,
  isTransientError,
} from "../utils/backoff.mjs";
import { createAnthropicMessagesProvider } from "../providers/anthropic-messages.mjs";
import { isAnthropicOAuthToken } from "../providers/anthropic-oauth-headers.mjs";

/**
 * xAI prompt-cache sticky routing.
 * Docs: set `x-grok-conv-id` on Chat Completions so related requests hit the
 * same cache shard. Optional body field is not used on Chat Completions;
 * Responses API uses `prompt_cache_key` instead (not this client).
 *
 * @param {object} opts
 * @param {string} [opts.convId]
 * @param {string} [opts.baseUrl]
 * @param {string} [opts.provider]
 * @param {object} [opts.cfg]
 * @returns {Record<string, string>}
 */
export function buildXaiCacheHeaders({ convId, baseUrl = "", provider = "", cfg } = {}) {
  const disabled = cfg?.tokens?.xaiConvId === false || cfg?.tokens?.xGrokConvId === false;
  if (disabled) return {};
  const id = String(
    convId ||
      cfg?.tokens?.xaiConvId ||
      cfg?.tokens?.xGrokConvId ||
      ""
  ).trim();
  if (!id) return {};
  const prov = String(provider || "").toLowerCase();
  const base = String(baseUrl || "").toLowerCase();
  const isXai =
    prov === "xai" ||
    prov === "x.ai" ||
    base.includes("api.x.ai") ||
    base.includes("x.ai");
  if (!isXai) return {};
  // Header values should be ASCII-ish; clamp length for safety
  const safe = id.replace(/[^\x20-\x7E]/g, "_").slice(0, 128);
  if (!safe) return {};
  return { "x-grok-conv-id": safe };
}


/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} [opts.baseUrl]  default https://api.openai.com/v1
 * @param {string} opts.model
 * @param {object} [opts.retry] backoff overrides
 * @param {object} [opts.cfg] full config (optional; retry read from cfg.retry / cfg.agent.retry)
 * @param {(info: object) => void} [opts.onRetry]
 */
export function createProvider(opts) {
  const baseUrl = (opts.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const apiKey = opts.apiKey || process.env.OPENAI_API_KEY || process.env.XCLAW_API_KEY || "";
  const defaultModel = opts.model || process.env.XCLAW_MODEL || "gpt-4o-mini";
  const defaultConvId =
    opts.convId ||
    opts.conversationId ||
    opts.sessionId ||
    null;
  const providerLabel = String(opts.provider || opts.providerName || "");

  // Native Anthropic Messages (API key or Claude OAuth) — required for OAuth attestation.
  // The sk-ant-oat token-shape auto-detect only applies when the provider is NOT
  // an explicit non-anthropic one — otherwise a mis-resolved Anthropic token would
  // force the Anthropic adapter for e.g. xai (Anthropic HTTP 404: model grok-*).
  const providerName = String(opts.provider || opts.providerName || "").toLowerCase();
  const explicitNonAnthropic =
    providerName && providerName !== "anthropic" && providerName !== "claude";
  const wantAnthropic =
    opts.api === "anthropic-messages" ||
    providerName === "anthropic" ||
    providerName === "claude" ||
    (!explicitNonAnthropic && isAnthropicOAuthToken(apiKey)) ||
    (baseUrl.includes("api.anthropic.com") && !opts.forceOpenAICompat);
  if (wantAnthropic && apiKey) {
    return createAnthropicMessagesProvider({
      apiKey,
      baseUrl: baseUrl.includes("anthropic") ? baseUrl : "https://api.anthropic.com/v1",
      model: defaultModel,
      cfg: opts.cfg,
      retry: opts.retry,
      onRetry: opts.onRetry,
      oauth: opts.oauth ?? isAnthropicOAuthToken(apiKey),
    });
  }
  const backoffOpts = {
    ...backoffOptsFromConfig(opts.cfg || {}),
    ...(opts.retry || {}),
  };
  const onRetry = opts.onRetry;

  // Sampling / reasoning config (cfg.agent.temperature, cfg.agent.reasoning).
  // temperature: undefined → default 0.2 (legacy); number → sent; null → field
  // omitted entirely (reasoning models reject or ignore it — omission is safe).
  // When reasoning is active and temperature is not explicitly configured, the
  // field is dropped.
  const agentCfg = opts.cfg?.agent || {};
  const reasoningCfg = agentCfg.reasoning || null;
  const reasoningActive = Boolean(
    reasoningCfg && (reasoningCfg.enabled === true || reasoningCfg.effort)
  );

  function resolveTemperature(callTemp) {
    if (callTemp !== undefined) return callTemp; // per-call override (null → omit)
    const t = agentCfg.temperature;
    if (t === null) return null;
    if (typeof t === "number" && Number.isFinite(t)) return t;
    if (reasoningActive) return null;
    return 0.2;
  }

  /** Apply temperature + reasoning fields to an OpenAI-compat request body. */
  function applySampling(body, callTemp) {
    const temp = resolveTemperature(callTemp);
    if (temp != null) body.temperature = temp;
    if (reasoningActive && reasoningCfg.effort) {
      body.reasoning_effort = String(reasoningCfg.effort);
    }
  }

  function chatOnce({ messages, tools, model, temperature, convId, conversationId, sessionId } = {}) {
    const url = new URL(`${baseUrl}/chat/completions`);
    const body = {
      model: model || defaultModel,
      messages,
    };
    applySampling(body, temperature);
    if (tools?.length) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const payload = JSON.stringify(body);
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;
    const cacheHeaders = buildXaiCacheHeaders({
      convId: convId || conversationId || sessionId || defaultConvId,
      baseUrl,
      provider: providerLabel || opts.provider || opts.providerName,
      cfg: opts.cfg,
    });

    return new Promise((resolve, reject) => {
      const req = lib.request(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "Content-Length": Buffer.byteLength(payload),
            ...cacheHeaders,
          },
          timeout: 180_000,
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            let parsed;
            try {
              parsed = JSON.parse(data);
            } catch {
              const err = new Error(
                `Invalid JSON from provider: ${data.slice(0, 200)}`
              );
              err.status = res.statusCode;
              reject(err);
              return;
            }
            if (res.statusCode >= 400) {
              const msg = parsed.error?.message || data.slice(0, 300);
              const err = new Error(`Provider HTTP ${res.statusCode}: ${msg}`);
              err.status = res.statusCode;
              err.body = parsed;
              err.type = parsed.error?.type || null;
              // Preserve Retry-After for jittered backoff (429/503 rate limits)
              err.headers = res.headers;
              const ra = res.headers?.["retry-after"];
              if (ra != null) err.retryAfter = ra;
              reject(err);
              return;
            }
            const choice = parsed.choices?.[0];
            if (!choice) {
              reject(new Error("Provider returned no choices"));
              return;
            }
            resolve({
              message: choice.message,
              finishReason: choice.finish_reason,
              usage: parsed.usage,
              raw: parsed,
            });
          });
        }
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        const err = new Error("provider timeout");
        err.code = "ETIMEDOUT";
        reject(err);
      });
      req.write(payload);
      req.end();
    });
  }

  /**
   * Chat with jittered backoff on transient failures.
   * @param {object} args
   * @param {AbortSignal} [args.signal]
   */
  async function chat(args) {
    return withBackoff(() => chatOnce(args), {
      ...backoffOpts,
      signal: args.signal,
      shouldRetry: isTransientError,
      onRetry: (info) => {
        onRetry?.(info);
        if (opts.cfg?.retry?.log !== false) {
          console.warn(
            `[xclaw] provider retry ${info.attempt}/${info.retries} after ${info.delayMs}ms: ${info.error?.message || info.error}`
          );
        }
      },
    });
  }

  /**
   * Streaming chat (SSE). Calls onDelta({ content?, tool_calls? }) per chunk.
   * Resolves to same shape as chat() when done.
   */
  async function chatStream({ messages, tools, model, temperature, signal, onDelta, convId, conversationId, sessionId } = {}) {
    const url = new URL(`${baseUrl}/chat/completions`);
    const body = {
      model: model || defaultModel,
      messages,
      stream: true,
    };
    applySampling(body, temperature);
    if (tools?.length) {
      body.tools = tools;
      body.tool_choice = "auto";
    }
    const payload = JSON.stringify(body);
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;
    const cacheHeaders = buildXaiCacheHeaders({
      convId: convId || conversationId || sessionId || defaultConvId,
      baseUrl,
      provider: providerLabel || opts.provider || opts.providerName,
      cfg: opts.cfg,
    });

    return withBackoff(
      () =>
        new Promise((resolve, reject) => {
          const req = lib.request(
            {
              hostname: url.hostname,
              port: url.port || (isHttps ? 443 : 80),
              path: url.pathname + url.search,
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
                "Content-Length": Buffer.byteLength(payload),
                Accept: "text/event-stream",
                ...cacheHeaders,
              },
              timeout: 180_000,
            },
            (res) => {
              if (res.statusCode >= 400) {
                let data = "";
                res.on("data", (c) => (data += c));
                res.on("end", () => {
                  let msg = data.slice(0, 300);
                  try {
                    msg = JSON.parse(data).error?.message || msg;
                  } catch {
                    /* */
                  }
                  const err = new Error(`Provider HTTP ${res.statusCode}: ${msg}`);
                  err.status = res.statusCode;
                  try {
                    const parsed = JSON.parse(msg);
                    err.body = parsed;
                    err.type = parsed.error?.type || null;
                  } catch {
                    /* */
                  }
                  err.headers = res.headers;
                  const ra = res.headers?.["retry-after"];
                  if (ra != null) err.retryAfter = ra;
                  reject(err);
                });
                return;
              }

              let buf = "";
              let content = "";
              /** @type {Map<number, { id?: string, type?: string, function?: { name?: string, arguments?: string } }>} */
              const toolMap = new Map();
              let finishReason = null;
              let usage = null;

              const flushLine = (line) => {
                const s = line.trim();
                if (!s.startsWith("data:")) return;
                const data = s.slice(5).trim();
                if (data === "[DONE]") return;
                let parsed;
                try {
                  parsed = JSON.parse(data);
                } catch {
                  return;
                }
                if (parsed.usage) usage = parsed.usage;
                const choice = parsed.choices?.[0];
                if (!choice) return;
                if (choice.finish_reason) finishReason = choice.finish_reason;
                const delta = choice.delta || {};
                if (delta.content) {
                  content += delta.content;
                  onDelta?.({ content: delta.content, accumulated: content });
                }
                if (Array.isArray(delta.tool_calls)) {
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    let cur = toolMap.get(idx);
                    if (!cur) {
                      cur = {
                        id: tc.id,
                        type: tc.type || "function",
                        function: { name: "", arguments: "" },
                      };
                      toolMap.set(idx, cur);
                    }
                    if (tc.id) cur.id = tc.id;
                    if (tc.function?.name) cur.function.name += tc.function.name;
                    if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
                  }
                  onDelta?.({ tool_calls: true, accumulated: content });
                }
              };

              res.on("data", (chunk) => {
                if (signal?.aborted) {
                  req.destroy();
                  return;
                }
                buf += chunk.toString("utf8");
                let idx;
                while ((idx = buf.indexOf("\n")) >= 0) {
                  const line = buf.slice(0, idx);
                  buf = buf.slice(idx + 1);
                  flushLine(line);
                }
              });
              res.on("end", () => {
                if (buf.trim()) flushLine(buf);
                const tool_calls = [...toolMap.entries()]
                  .sort((a, b) => a[0] - b[0])
                  .map(([, v]) => v)
                  .filter((t) => t.id || t.function?.name);
                const message = {
                  role: "assistant",
                  content: content || null,
                };
                if (tool_calls.length) message.tool_calls = tool_calls;
                resolve({
                  message,
                  finishReason: finishReason || "stop",
                  usage,
                  raw: { streamed: true },
                });
              });
              res.on("error", reject);
            }
          );
          if (signal) {
            const onAbort = () => {
              req.destroy();
              reject(Object.assign(new Error("aborted"), { code: "ABORT_ERR" }));
            };
            if (signal.aborted) onAbort();
            else signal.addEventListener("abort", onAbort, { once: true });
          }
          req.on("error", reject);
          req.on("timeout", () => {
            req.destroy();
            const err = new Error("provider timeout");
            err.code = "ETIMEDOUT";
            reject(err);
          });
          req.write(payload);
          req.end();
        }),
      {
        ...backoffOpts,
        signal,
        shouldRetry: isTransientError,
        onRetry: (info) => {
          onRetry?.(info);
          if (opts.cfg?.retry?.log !== false) {
            console.warn(
              `[xclaw] provider stream retry ${info.attempt}/${info.retries} after ${info.delayMs}ms: ${info.error?.message || info.error}`
            );
          }
        },
      }
    );
  }

  return {
    chat,
    chatStream,
    model: defaultModel,
    baseUrl,
    backoffOpts,
    defaultConvId,
    buildXaiCacheHeaders: (id) =>
      buildXaiCacheHeaders({
        convId: id || defaultConvId,
        baseUrl,
        provider: providerLabel || opts.provider || opts.providerName,
        cfg: opts.cfg,
      }),
  };
}
