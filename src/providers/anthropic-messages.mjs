/**
 * Native Anthropic Messages API provider (OpenAI-shaped chat() for agent loop).
 *
 * OAuth (sk-ant-oat01-*):
 *   - Bearer + anthropic-beta: oauth-2025-04-20
 *   - system must start with OAUTH_ATTESTATION (else Sonnet/Opus/Fable → 429)
 * API key (sk-ant-api*):
 *   - x-api-key header
 */

import https from "node:https";
import http from "node:http";
import {
  withBackoff,
  backoffOptsFromConfig,
  isTransientError,
} from "../utils/backoff.mjs";
import {
  OAUTH_ATTESTATION,
  buildAnthropicOAuthHeaders,
  ensureOAuthSystemAttestation,
  isAnthropicOAuthToken,
  ANTHROPIC_VERSION,
} from "./anthropic-oauth-headers.mjs";

function httpJson(urlStr, { method = "POST", headers, body, timeout = 180_000 }) {
  const url = new URL(urlStr);
  const isHttps = url.protocol === "https:";
  const lib = isHttps ? https : http;
  const payload = body == null ? null : JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          ...headers,
          ...(payload
            ? { "Content-Length": Buffer.byteLength(payload) }
            : {}),
        },
        timeout,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = null;
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: data,
            json: parsed,
          });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      const err = new Error("anthropic provider timeout");
      err.code = "ETIMEDOUT";
      reject(err);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * OpenAI-style messages → Anthropic messages + system.
 */
export function toAnthropicMessages(openaiMessages = []) {
  let systemParts = [];
  const messages = [];

  for (const m of openaiMessages) {
    const role = m.role;
    if (role === "system") {
      const t = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      if (t) systemParts.push(t);
      continue;
    }

    if (role === "assistant") {
      const blocks = [];
      if (m.content) {
        blocks.push({
          type: "text",
          text: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        });
      }
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          let input = {};
          try {
            input =
              typeof tc.function?.arguments === "string"
                ? JSON.parse(tc.function.arguments || "{}")
                : tc.function?.arguments || {};
          } catch {
            input = { raw: tc.function?.arguments };
          }
          blocks.push({
            type: "tool_use",
            id: tc.id || `toolu_${Math.random().toString(36).slice(2)}`,
            name: tc.function?.name || tc.name || "tool",
            input,
          });
        }
      }
      if (blocks.length === 0) blocks.push({ type: "text", text: "" });
      messages.push({ role: "assistant", content: blocks });
      continue;
    }

    if (role === "tool") {
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.tool_call_id || m.id,
            content:
              typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""),
          },
        ],
      });
      continue;
    }

    // user
    messages.push({
      role: "user",
      content:
        typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content)
            ? m.content
            : JSON.stringify(m.content ?? ""),
    });
  }

  // Merge consecutive user tool_result messages
  const merged = [];
  for (const msg of messages) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.role === "user" &&
      msg.role === "user" &&
      Array.isArray(prev.content) &&
      Array.isArray(msg.content) &&
      prev.content.every((b) => b.type === "tool_result") &&
      msg.content.every((b) => b.type === "tool_result")
    ) {
      prev.content = [...prev.content, ...msg.content];
    } else {
      merged.push(msg);
    }
  }

  return {
    system: systemParts.filter(Boolean).join("\n\n"),
    messages: merged,
  };
}

/**
 * OpenAI tools → Anthropic tools
 */
export function toAnthropicTools(openaiTools = []) {
  if (!openaiTools?.length) return undefined;
  return openaiTools.map((t) => {
    const fn = t.function || t;
    return {
      name: fn.name,
      description: fn.description || "",
      input_schema: fn.parameters || fn.input_schema || { type: "object", properties: {} },
    };
  });
}

/**
 * Anthropic message → OpenAI assistant message shape
 */
export function fromAnthropicMessage(msg) {
  const contentBlocks = Array.isArray(msg?.content) ? msg.content : [];
  const textParts = [];
  const tool_calls = [];

  for (const b of contentBlocks) {
    if (b.type === "text" && b.text) textParts.push(b.text);
    if (b.type === "tool_use") {
      tool_calls.push({
        id: b.id,
        type: "function",
        function: {
          name: b.name,
          arguments: JSON.stringify(b.input ?? {}),
        },
      });
    }
  }

  const assistant = {
    role: "assistant",
    content: textParts.join("") || null,
  };
  if (tool_calls.length) assistant.tool_calls = tool_calls;
  return assistant;
}

function authHeaders(apiKey, opts = {}) {
  if (isAnthropicOAuthToken(apiKey)) {
    return buildAnthropicOAuthHeaders(apiKey, opts);
  }
  return {
    "content-type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
    "x-api-key": apiKey,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} [opts.baseUrl]
 * @param {string} [opts.model]
 * @param {object} [opts.cfg]
 * @param {boolean} [opts.oauth] force oauth mode
 * @param {(info:object)=>void} [opts.onRetry]
 */
export function createAnthropicMessagesProvider(opts = {}) {
  const apiKey =
    opts.apiKey ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_CODE_OAUTH_TOKEN ||
    process.env.ANTHROPIC_AUTH_TOKEN ||
    "";
  const baseUrl = (opts.baseUrl || "https://api.anthropic.com/v1").replace(/\/$/, "");
  const defaultModel = opts.model || "claude-sonnet-5";
  const oauth = opts.oauth ?? isAnthropicOAuthToken(apiKey);
  const backoffOpts = {
    ...backoffOptsFromConfig(opts.cfg || {}),
    ...(opts.retry || {}),
  };
  const onRetry = opts.onRetry;

  async function messagesOnce({ messages, tools, model, temperature, max_tokens }) {
    const converted = toAnthropicMessages(messages);
    const body = {
      model: model || defaultModel,
      max_tokens: max_tokens ?? opts.cfg?.agent?.maxTokens ?? 4096,
      messages: converted.messages,
    };
    if (temperature != null) body.temperature = temperature;

    let system = converted.system || "";
    if (oauth) {
      // Required attestation as exact first system text
      if (!system.startsWith(OAUTH_ATTESTATION)) {
        system = system
          ? `${OAUTH_ATTESTATION}\n\n${system}`
          : OAUTH_ATTESTATION;
      }
      body.system = system;
      ensureOAuthSystemAttestation(body);
    } else if (system) {
      body.system = system;
    }

    const anthTools = toAnthropicTools(tools);
    if (anthTools?.length) {
      body.tools = anthTools;
    }

    const headers = authHeaders(apiKey);
    const res = await httpJson(`${baseUrl}/messages`, {
      method: "POST",
      headers,
      body,
    });

    if (res.status >= 400) {
      const msg =
        res.json?.error?.message ||
        res.text?.slice(0, 300) ||
        `HTTP ${res.status}`;
      const err = new Error(`Anthropic HTTP ${res.status}: ${msg}`);
      err.status = res.status;
      err.body = res.json;
      err.type = res.json?.error?.type || null;
      err.headers = res.headers;
      if (res.headers?.["retry-after"]) err.retryAfter = res.headers["retry-after"];
      throw err;
    }

    const assistant = fromAnthropicMessage(res.json);
    return {
      message: assistant,
      finishReason:
        res.json?.stop_reason === "tool_use"
          ? "tool_calls"
          : res.json?.stop_reason || "stop",
      usage: res.json?.usage
        ? {
            prompt_tokens: res.json.usage.input_tokens,
            completion_tokens: res.json.usage.output_tokens,
            total_tokens:
              (res.json.usage.input_tokens || 0) +
              (res.json.usage.output_tokens || 0),
          }
        : undefined,
      raw: res.json,
    };
  }

  async function chat(args) {
    return withBackoff(() => messagesOnce(args), {
      ...backoffOpts,
      signal: args.signal,
      shouldRetry: isTransientError,
      onRetry: (info) => {
        onRetry?.(info);
        if (opts.cfg?.retry?.log !== false) {
          console.warn(
            `[xclaw] anthropic retry ${info.attempt}/${info.retries} after ${info.delayMs}ms: ${info.error?.message || info.error}`
          );
        }
      },
    });
  }

  return {
    kind: "anthropic-messages",
    oauth,
    baseUrl,
    model: defaultModel,
    chat,
    /** Stream not fully SSE-parsed yet — falls back to non-stream chat */
    chatStream: async (args) => chat(args),
    OAUTH_ATTESTATION,
  };
}

export default createAnthropicMessagesProvider;
