/**
 * Adapted from OpenClaw (MIT) — openai-compatible-image-provider patterns
 */
export function createOpenAICompatibleImageProvider(opts = {}) {
  const id = opts.id || "openai";
  const baseUrl = (opts.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const defaultModel = opts.defaultModel || "dall-e-3";

  return {
    id,
    aliases: opts.aliases || [],
    defaultModel,
    models: opts.models || [defaultModel, "dall-e-2", "gpt-image-1"],
    isConfigured: ({ apiKey, env } = {}) =>
      Boolean(apiKey || env?.OPENAI_API_KEY || process.env.OPENAI_API_KEY || process.env.XCLAW_API_KEY),

    async generate({ prompt, model, size, apiKey, n = 1, signal } = {}) {
      const key =
        apiKey || process.env.OPENAI_API_KEY || process.env.XCLAW_API_KEY;
      if (!key) {
        throw new Error("No API key configured for image provider " + id);
      }
      const body = {
        model: model || defaultModel,
        prompt: String(prompt || "").slice(0, 4000),
        n: Math.min(4, Math.max(1, n)),
      };
      // Only send size when the caller asked for one — xAI's images API
      // rejects the argument outright ("Argument not supported: size"), and
      // OpenAI defaults it server-side anyway.
      if (size) body.size = size;
      const r = await fetch(`${baseUrl}/images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        signal,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        // OpenAI nests {error:{message}}; xAI returns {error:"string"} — the
        // old extraction dropped xAI's text, hiding "Argument not supported".
        const msg =
          data.error?.message ||
          (typeof data.error === "string" ? data.error : null) ||
          `image API ${r.status}`;
        throw new Error(msg);
      }
      return {
        provider: id,
        model: body.model,
        images: (data.data || []).map((d) => ({
          url: d.url,
          b64: d.b64_json,
          revisedPrompt: d.revised_prompt,
        })),
        raw: data,
      };
    },
  };
}
