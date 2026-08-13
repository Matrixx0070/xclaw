/**
 * Adapted from OpenClaw (MIT) — image-generation runtime fallback patterns (subset)
 */
import { listMediaProviders, getMediaProvider } from "./provider-registry.mjs";

export function resolveMediaProviderRequestTimeoutMs({ timeoutMs, providerDefaultTimeoutMs } = {}) {
  const pick = (v) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(v, 600_000) : undefined;
  return pick(timeoutMs) ?? pick(providerDefaultTimeoutMs);
}

/**
 * Try providers in order until one succeeds.
 */
export async function generateImageWithFallback(params = {}) {
  const {
    prompt,
    model,
    size,
    apiKey,
    apiKeys, // per-provider {id: key} — resolved from the credential store
    preferredProvider,
    providerIds,
    signal,
    timeoutMs,
  } = params;

  const attempts = [];
  const ordered = [];
  if (preferredProvider) ordered.push(preferredProvider);
  for (const id of providerIds || []) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  for (const p of listMediaProviders("image")) {
    if (!ordered.includes(p.id)) ordered.push(p.id);
  }

  if (!ordered.length) {
    return {
      ok: false,
      error: "No image generation providers registered",
      attempts,
    };
  }

  for (const id of ordered) {
    const provider = getMediaProvider("image", id);
    if (!provider?.generate) {
      attempts.push({ provider: id, error: "missing generate()" });
      continue;
    }
    try {
      const controller = new AbortController();
      const ms = resolveMediaProviderRequestTimeoutMs({ timeoutMs });
      let timer;
      if (ms) {
        timer = setTimeout(() => controller.abort(), ms);
      }
      if (signal) {
        signal.addEventListener("abort", () => controller.abort(), { once: true });
      }
      try {
        const result = await provider.generate({
          prompt,
          model,
          size,
          apiKey: (apiKeys && apiKeys[id]) || apiKey,
          signal: controller.signal,
        });
        return { ok: true, result, attempts };
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (err) {
      attempts.push({
        provider: id,
        model: model || provider.defaultModel,
        error: err.message || String(err),
      });
    }
  }

  return {
    ok: false,
    error: attempts.map((a) => `${a.provider}: ${a.error}`).join("; ") || "all providers failed",
    attempts,
  };
}
