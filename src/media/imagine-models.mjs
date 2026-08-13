/**
 * Imagine / image-gen model matrix (P4.3).
 * Override via cfg.image.models or env XCLAW_IMAGE_MODELS=comma,list
 */
export const DEFAULT_IMAGINE_MODELS = [
  // Current xAI image models (2026) — the grok-2-image* ids were retired.
  "grok-imagine-image",
  "grok-imagine-image-2.0",
  "grok-imagine-image-quality",
  // Legacy fallbacks (older accounts / gateways may still serve these).
  "grok-2-image",
  "grok-2-image-1212",
];

export const DEFAULT_IMAGINE_ENDPOINTS = [
  "https://api.x.ai/v1/images/generations",
];

export function resolveImagineMatrix(cfg = {}) {
  const fromEnv = process.env.XCLAW_IMAGE_MODELS
    ? process.env.XCLAW_IMAGE_MODELS.split(",").map((s) => s.trim()).filter(Boolean)
    : null;
  const models =
    fromEnv ||
    cfg.image?.models ||
    (process.env.XCLAW_IMAGE_MODEL ? [process.env.XCLAW_IMAGE_MODEL] : null) ||
    DEFAULT_IMAGINE_MODELS;
  const endpoints =
    cfg.image?.endpoints ||
    DEFAULT_IMAGINE_ENDPOINTS;
  return {
    models: [...new Set(models.filter(Boolean))],
    endpoints: [...new Set(endpoints.filter(Boolean))],
    responseFormat: cfg.image?.responseFormat || "b64_json",
  };
}
