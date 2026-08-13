/**
 * Canvas + media jobs — OpenClaw canvas/media-generation surface (subset).
 */
import { randomUUID } from "node:crypto";
import { registerMediaProvider, listMediaProviders } from "./provider-registry.mjs";
import { createOpenAICompatibleImageProvider } from "./openai-image.mjs";
import { generateImageWithFallback } from "./runtime.mjs";
import { DEFAULT_IMAGINE_MODELS } from "./imagine-models.mjs";

// Register default OpenAI-compatible provider (works with xAI if baseUrl set)
registerMediaProvider(
  "image",
  createOpenAICompatibleImageProvider({
    id: "openai",
    aliases: ["oai"],
    defaultModel: "dall-e-3",
  })
);
registerMediaProvider(
  "image",
  createOpenAICompatibleImageProvider({
    id: "xai",
    aliases: ["grok"],
    baseUrl: process.env.XAI_BASE_URL || "https://api.x.ai/v1",
    // Track the imagine matrix — the hardcoded "grok-2-image" default kept
    // 404ing after xAI retired that id (live API serves grok-imagine-image*).
    defaultModel: process.env.XCLAW_IMAGE_MODEL || DEFAULT_IMAGINE_MODELS[0],
    models: DEFAULT_IMAGINE_MODELS,
  })
);

const jobs = new Map();
const canvases = new Map();

export function createCanvas({ title } = {}) {
  const id = randomUUID();
  const c = {
    id,
    title: title || "canvas",
    layers: [],
    createdAt: new Date().toISOString(),
  };
  canvases.set(id, c);
  return c;
}

export function getCanvas(id) {
  return canvases.get(id) || null;
}

export function listCanvases() {
  return [...canvases.values()];
}

export function addLayer(canvasId, layer) {
  const c = canvases.get(canvasId);
  if (!c) return null;
  const entry = { id: randomUUID(), ...layer, at: new Date().toISOString() };
  c.layers.push(entry);
  return entry;
}

export async function enqueueMediaJob({
  type = "image",
  prompt,
  opts = {},
  provider,
  model,
  size,
  apiKey,
  apiKeys,
} = {}) {
  const id = randomUUID();
  const job = {
    id,
    type,
    prompt,
    opts,
    status: "running",
    createdAt: new Date().toISOString(),
    result: null,
    error: null,
  };
  jobs.set(id, job);

  if (type !== "image") {
    job.status = "unsupported";
    job.error = `Media type ${type} not configured`;
    return job;
  }

  if (!prompt) {
    job.status = "error";
    job.error = "prompt required";
    return job;
  }

  const providers = listMediaProviders("image");
  if (!providers.length) {
    job.status = "unsupported";
    job.error = "No image providers registered";
    return job;
  }

  const out = await generateImageWithFallback({
    prompt,
    model: model || opts.model,
    size: size || opts.size,
    apiKey: apiKey || opts.apiKey,
    apiKeys: apiKeys || opts.apiKeys,
    preferredProvider: provider || opts.provider,
  });

  if (out.ok) {
    job.status = "done";
    job.result = out.result;
    job.attempts = out.attempts;
  } else {
    job.status = "error";
    job.error = out.error;
    job.attempts = out.attempts;
  }
  return job;
}

export function getMediaJob(id) {
  return jobs.get(id) || null;
}

export function listMediaJobs() {
  return [...jobs.values()];
}

export function listImageProviders() {
  return listMediaProviders("image").map((p) => ({
    id: p.id,
    defaultModel: p.defaultModel,
    models: p.models,
  }));
}
