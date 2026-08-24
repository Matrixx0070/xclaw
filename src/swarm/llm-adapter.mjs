/**
 * LLM adapter — maps the swarm-ext vendor interface onto xclaw's provider.
 *
 * The vendored swarm code (orchestrator/sub-agent/dag-engine/merge) expects:
 *   llm.chat(messages, { temperature, tools }) ->
 *     { content, toolCalls: [{ name, arguments }], usage: { promptTokens, completionTokens } }
 *   llm.structuredOutput(messages, schema, temperature) -> parsed object
 *   llm.model -> string (used for cost estimation)
 *
 * xclaw's createProvider exposes:
 *   provider.chat({ messages, tools, model, temperature, ... }) ->
 *     { message, finishReason, usage (OpenAI snake_case), raw }
 *
 * This file has NO external dependencies so it is unit-testable in CI
 * without the extension's node_modules being installed.
 */

function safeParseArgs(raw) {
  if (raw == null) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: String(raw) };
  }
}

/** Strip markdown fences and extract the first JSON object/array in text. */
export function extractJson(text) {
  if (text == null) throw new Error("empty LLM response");
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    // fall through: locate first balanced JSON value
  }
  const start = t.search(/[{[]/);
  if (start === -1) throw new Error(`no JSON found in LLM response: ${t.slice(0, 120)}`);
  const open = t[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return JSON.parse(t.slice(start, i + 1));
    }
  }
  throw new Error(`unbalanced JSON in LLM response: ${t.slice(start, start + 120)}`);
}

/** Wrap an already-constructed xclaw provider into the swarm-ext llm interface. */
export function wrapProvider(provider, { convId } = {}) {
  if (!provider || typeof provider.chat !== "function") {
    throw new Error("wrapProvider: xclaw provider with .chat(args) required");
  }

  async function chat(messages, opts = {}) {
    const res = await provider.chat({
      messages,
      tools: opts.tools,
      temperature: opts.temperature,
      model: opts.model,
      convId,
    });
    const msg = res?.message || {};
    const toolCalls = (msg.tool_calls || []).map((tc) => ({
      id: tc.id,
      name: tc.function?.name || tc.name,
      arguments: safeParseArgs(tc.function?.arguments ?? tc.arguments),
    }));
    return {
      content: typeof msg.content === "string" ? msg.content : (msg.content ?? ""),
      toolCalls,
      usage: {
        promptTokens: res?.usage?.prompt_tokens ?? res?.usage?.promptTokens ?? 0,
        completionTokens: res?.usage?.completion_tokens ?? res?.usage?.completionTokens ?? 0,
      },
      finishReason: res?.finishReason,
    };
  }

  async function structuredOutput(messages, schema, temperature = 0.2) {
    const isZod = schema && typeof schema.safeParse === "function";
    const schemaHint = isZod
      ? "" // zod schemas are not JSON-serializable; the prompt already describes the shape
      : schema
        ? `\nThe JSON MUST match this schema:\n${JSON.stringify(schema)}`
        : "";
    const sys = {
      role: "system",
      content: `Respond ONLY with valid JSON. No prose, no markdown fences.${schemaHint}`,
    };
    const attempt = async (extra) => {
      const res = await chat([sys, ...messages, ...(extra ? [extra] : [])], { temperature });
      return extractJson(res.content);
    };
    let parsed;
    try {
      parsed = await attempt();
    } catch (e1) {
      // one retry with the parse error fed back
      parsed = await attempt({
        role: "user",
        content: `Your previous response was not valid JSON (${e1.message}). Respond again with ONLY valid JSON.`,
      });
    }
    if (isZod) {
      const v = schema.safeParse(parsed);
      if (v.success) return v.data;
      // one corrective retry with validation errors
      const retry = await attempt({
        role: "user",
        content: `Your JSON failed validation: ${JSON.stringify(v.error.issues).slice(0, 800)}. Respond again with ONLY corrected valid JSON.`,
      });
      const v2 = schema.safeParse(retry);
      if (v2.success) return v2.data;
      throw new Error(`structuredOutput failed schema validation: ${v2.error.issues?.[0]?.message || "invalid"}`);
    }
    return parsed;
  }

  return {
    model: provider.model || "unknown",
    chat,
    structuredOutput,
  };
}

/**
 * Build a swarm-ext llm client from xclaw config, using xclaw's own
 * provider routing (same path missions/engine.mjs uses).
 */
export async function createSwarmLlmAdapter(cfg, { model } = {}) {
  const { resolveProviderRouteAsync } = await import("../providers/registry.mjs");
  const { createProvider } = await import("../agent/provider.mjs");
  const route = await resolveProviderRouteAsync(cfg, model ? { model } : {});
  const provider = createProvider({
    apiKey: route.apiKey || cfg?.agent?.apiKey,
    baseUrl: route.baseUrl,
    model: route.model || model,
    provider: route.provider,
    api: route.api,
    cfg,
  });
  provider.providerName = route.provider;
  return wrapProvider(provider, { convId: "swarm-ext" });
}
