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

/** Normalize one system-content entry into Anthropic text blocks. */
function systemContentToBlocks(content) {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  if (Array.isArray(content)) {
    // Cache-breakpoint builder emits [{type:"text", text, cache_control?}].
    // Preserve structure — stringifying this array (the old behavior) turned
    // the whole prefix into a JSON blob and dropped every cache mark.
    const out = [];
    for (const part of content) {
      if (part == null) continue;
      if (typeof part === "string") {
        if (part) out.push({ type: "text", text: part });
        continue;
      }
      const text = typeof part.text === "string" ? part.text : typeof part.content === "string" ? part.content : "";
      if (!text) continue;
      const block = { type: "text", text };
      if (part.cache_control && typeof part.cache_control === "object") {
        block.cache_control = part.cache_control;
      }
      out.push(block);
    }
    return out;
  }
  if (content && typeof content === "object" && typeof content.text === "string") {
    return content.text ? [{ type: "text", text: content.text }] : [];
  }
  return [];
}

/**
 * Anthropic allows at most 4 cache_control breakpoints per request. Keep the
 * LAST `max` markers (they cover the longest prefixes) and silently strip the
 * rest.
 */
export function capCacheBreakpoints(blocks, max = 4) {
  const marked = (blocks || []).filter((b) => b.cache_control);
  if (marked.length <= max) return blocks;
  const drop = new Set(marked.slice(0, marked.length - max));
  return blocks.map((b) => {
    if (!drop.has(b)) return b;
    const { cache_control, ...rest } = b;
    return rest;
  });
}

/**
 * OpenAI-style messages → Anthropic messages + system.
 * `system` is the flattened text (back-compat); `systemBlocks` is the
 * structured Anthropic form (present whenever any system entry was
 * structured), preserving cache_control breakpoints from the loop's
 * cache-breakpoints builder.
 */
export function toAnthropicMessages(openaiMessages = []) {
  /** @type {Array<{type:string,text:string,cache_control?:object}>} */
  let systemBlockParts = [];
  let sawStructuredSystem = false;
  const messages = [];

  for (const m of openaiMessages) {
    const role = m.role;
    if (role === "system") {
      if (typeof m.content !== "string") sawStructuredSystem = true;
      systemBlockParts.push(...systemContentToBlocks(m.content));
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
    system: systemBlockParts.map((b) => b.text).filter(Boolean).join("\n\n"),
    systemBlocks: sawStructuredSystem && systemBlockParts.length ? systemBlockParts : null,
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

  const thinkingParts = [];
  for (const b of contentBlocks) {
    if (b.type === "text" && b.text) textParts.push(b.text);
    if (b.type === "thinking" && b.thinking) thinkingParts.push(b.thinking);
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
  if (thinkingParts.length) assistant.reasoning = thinkingParts.join("");
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

  // Prompt caching: emit cache_control breakpoints unless explicitly disabled
  // (opts.cache === false, tokens.cacheBreakpoints.enabled === false, or
  // mode none/off). Caching is free savings on Anthropic — default ON.
  const bpCfg = opts.cfg?.tokens?.cacheBreakpoints || {};
  const cacheEnabled =
    opts.cache !== false &&
    bpCfg.enabled !== false &&
    !["none", "off"].includes(String(bpCfg.mode || "").toLowerCase());

  // Extended thinking (cfg.agent.reasoning = { enabled?, effort?, maxTokens? }).
  // Absent → no thinking field, zero wire change. When active: body.thinking =
  // { type:"enabled", budget_tokens } and temperature is OMITTED (the API
  // requires temperature unset/1 with thinking enabled).
  const reasoningCfg = opts.cfg?.agent?.reasoning || null;
  const thinkingActive = Boolean(
    reasoningCfg && (reasoningCfg.enabled === true || reasoningCfg.effort)
  );
  const EFFORT_BUDGET = { low: 4096, medium: 10000, high: 20000 };
  const thinkingBudget = thinkingActive
    ? Number(reasoningCfg.maxTokens) ||
      EFFORT_BUDGET[String(reasoningCfg.effort || "").toLowerCase()] ||
      10000
    : 0;
  const cfgTemperature = opts.cfg?.agent?.temperature;

  /** Temperature + thinking for a request body (both chat and stream). */
  function applySampling(body, callTemp) {
    if (thinkingActive) {
      body.thinking = { type: "enabled", budget_tokens: thinkingBudget };
      // budget_tokens must be < max_tokens — grow max_tokens to fit
      if (body.max_tokens <= thinkingBudget) {
        body.max_tokens = thinkingBudget + 4096;
      }
      return; // temperature omitted with thinking enabled
    }
    const temp =
      callTemp !== undefined
        ? callTemp
        : typeof cfgTemperature === "number" && Number.isFinite(cfgTemperature)
          ? cfgTemperature
          : undefined;
    if (temp != null) body.temperature = temp;
  }

  /**
   * Attach system content to the request body: structured blocks with capped
   * cache_control when available, single cache-marked block for plain-string
   * systems, attestation-first for OAuth.
   */
  function applySystem(body, converted) {
    let system;
    if (converted.systemBlocks) {
      let blocks = converted.systemBlocks;
      if (!cacheEnabled) {
        blocks = blocks.map(({ cache_control, ...rest }) => rest);
      }
      system = capCacheBreakpoints(blocks);
    } else if (converted.system) {
      system = cacheEnabled
        ? [{ type: "text", text: converted.system, cache_control: { type: "ephemeral" } }]
        : converted.system;
    } else {
      system = "";
    }
    if (oauth) {
      body.system = system;
      ensureOAuthSystemAttestation(body);
    } else if (typeof system === "string" ? system : system.length) {
      body.system = system;
    }
  }

  async function messagesOnce({ messages, tools, model, temperature, max_tokens }) {
    const converted = toAnthropicMessages(messages);
    const body = {
      model: model || defaultModel,
      max_tokens: max_tokens ?? opts.cfg?.agent?.maxTokens ?? 4096,
      messages: converted.messages,
    };
    applySampling(body, temperature);

    applySystem(body, converted);

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


  /**
   * Anthropic Messages SSE stream.
   * Emits onDelta({ text }) for text deltas; assembles full assistant message
   * (including tool_use) for the return value.
   */
  async function chatStream(args = {}) {
    const {
      messages,
      tools,
      model,
      temperature,
      max_tokens,
      signal,
      onDelta,
    } = args;

    const converted = toAnthropicMessages(messages);
    const body = {
      model: model || defaultModel,
      max_tokens: max_tokens ?? opts.cfg?.agent?.maxTokens ?? 4096,
      stream: true,
      messages: converted.messages,
    };
    applySampling(body, temperature);

    applySystem(body, converted);

    const anthTools = toAnthropicTools(tools);
    if (anthTools?.length) body.tools = anthTools;

    const headers = {
      ...authHeaders(apiKey),
      accept: "text/event-stream",
    };

    const res = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      let text = "";
      try {
        text = await res.text();
      } catch {
        /* */
      }
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* */
      }
      const msg =
        json?.error?.message || text.slice(0, 300) || `HTTP ${res.status}`;
      const err = new Error(`Anthropic HTTP ${res.status}: ${msg}`);
      err.status = res.status;
      err.body = json;
      throw err;
    }

    // Fallback if body is not a stream
    if (!res.body || typeof res.body.getReader !== "function") {
      return chat(args);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let textOut = "";
    let thinkingOut = "";
    /** @type {Array<{id:string, name:string, input:object, _json:string}>} */
    const toolBlocks = [];
    let currentTool = null;
    let stopReason = "stop";
    let usage = undefined;

    function handleEvent(evt, data) {
      if (!data || data === "[DONE]") return;
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      const type = parsed.type || evt;

      if (type === "content_block_start") {
        const block = parsed.content_block;
        if (block?.type === "tool_use") {
          currentTool = {
            id: block.id,
            name: block.name,
            input: {},
            _json: "",
          };
          toolBlocks.push(currentTool);
        }
      } else if (type === "content_block_delta") {
        const d = parsed.delta;
        if (d?.type === "text_delta" && d.text) {
          textOut += d.text;
          onDelta?.({ text: d.text, type: "text" });
        } else if (d?.type === "input_json_delta" && currentTool && d.partial_json) {
          currentTool._json += d.partial_json;
          onDelta?.({ type: "tool_json", partial: d.partial_json });
        } else if (d?.type === "thinking_delta" && d.thinking) {
          // Extended-thinking deltas: keep separate from text accumulation.
          thinkingOut += d.thinking;
          onDelta?.({ type: "thinking", text: d.thinking });
        }
        // signature_delta and unknown delta types are intentionally ignored.
      } else if (type === "content_block_stop") {
        if (currentTool) {
          try {
            currentTool.input = currentTool._json
              ? JSON.parse(currentTool._json)
              : {};
          } catch {
            currentTool.input = { _raw: currentTool._json };
          }
          currentTool = null;
        }
      } else if (type === "message_delta") {
        if (parsed.delta?.stop_reason) stopReason = parsed.delta.stop_reason;
        if (parsed.usage) {
          usage = {
            prompt_tokens: parsed.usage.input_tokens,
            completion_tokens: parsed.usage.output_tokens,
            total_tokens:
              (parsed.usage.input_tokens || 0) +
              (parsed.usage.output_tokens || 0),
          };
        }
      } else if (type === "message_start" && parsed.message?.usage) {
        usage = {
          prompt_tokens: parsed.message.usage.input_tokens,
          completion_tokens: parsed.message.usage.output_tokens || 0,
          total_tokens:
            (parsed.message.usage.input_tokens || 0) +
            (parsed.message.usage.output_tokens || 0),
        };
      }
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE frames separated by blank lines
      for (;;) {
        const idx = buf.indexOf("\n\n");
        if (idx < 0) break;
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let eventName = "message";
        const dataLines = [];
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length) handleEvent(eventName, dataLines.join("\n"));
      }
    }

    const tool_calls = toolBlocks.map((tb) => ({
      id: tb.id,
      type: "function",
      function: {
        name: tb.name,
        arguments: JSON.stringify(tb.input || {}),
      },
    }));

    const assistant = {
      role: "assistant",
      content: textOut || null,
    };
    if (tool_calls.length) assistant.tool_calls = tool_calls;
    if (thinkingOut) assistant.reasoning = thinkingOut;

    return {
      message: assistant,
      finishReason: stopReason === "tool_use" ? "tool_calls" : stopReason || "stop",
      usage,
      raw: { streamed: true, stopReason },
    };
  }

  return {
    kind: "anthropic-messages",
    oauth,
    baseUrl,
    model: defaultModel,
    chat,
    chatStream,
    OAUTH_ATTESTATION,
  };
}

export default createAnthropicMessagesProvider;
