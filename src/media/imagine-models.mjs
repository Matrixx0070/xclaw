/**
 * Imagine / image-gen model matrix (P4.3).
 * Override via cfg.image.models or env XCLAW_IMAGE_MODELS=comma,list
 */
export const DEFAULT_IMAGINE_MODELS = [
  "grok-2-image",
  "grok-2-image-1212",
  "grok-imagine",
  "grok-2-vision-1212", // some gateways misuse; still try last for gen endpoints only if listed
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
