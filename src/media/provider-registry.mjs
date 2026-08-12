/**
 * Adapted from OpenClaw (MIT) — media-generation/provider-registry patterns
 * Lightweight registry for image (and future video) providers.
 */

const registries = {
  image: new Map(),
  video: new Map(),
  music: new Map(),
};

export function normalizeProviderId(id) {
  return String(id || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-");
}

export function registerMediaProvider(kind, provider) {
  const k = kind || "image";
  if (!registries[k]) registries[k] = new Map();
  const id = normalizeProviderId(provider.id);
  const entry = { ...provider, id };
  registries[k].set(id, entry);
  for (const a of provider.aliases || []) {
    registries[k].set(normalizeProviderId(a), entry);
  }
  return entry;
}

export function listMediaProviders(kind = "image") {
  const map = registries[kind] || new Map();
  const seen = new Set();
  const out = [];
  for (const p of map.values()) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

export function getMediaProvider(kind, providerId) {
  const id = normalizeProviderId(providerId);
  if (!id) return undefined;
  return (registries[kind] || new Map()).get(id);
}

export function createMediaProviderRegistry(kind) {
  return {
    listProviders: () => listMediaProviders(kind),
    getProvider: (providerId) => getMediaProvider(kind, providerId),
  };
}
