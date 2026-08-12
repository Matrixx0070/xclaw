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
        size: size || "1024x1024",
      };
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
        throw new Error(data.error?.message || `image API ${r.status}`);
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
