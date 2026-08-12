/**
 * Provider pack — thin wrapper over providers/registry.
 */
import {
  BUILTIN_PROVIDERS,
  resolveProviderRoute,
  listProviders,
  listModels,
} from "../providers/registry.mjs";

export const PROVIDER_PRESETS = Object.fromEntries(
  Object.entries(BUILTIN_PROVIDERS).map(([id, p]) => [
    id,
    {
      name: p.name,
      baseUrl: p.baseUrl,
      model: p.defaultModel,
      envKey: p.envKey,
    },
  ])
);

export function resolveProviderPack(cfg = {}) {
  const route = resolveProviderRoute(cfg);
  return {
    id: route.provider,
    name: route.name,
    baseUrl: route.baseUrl,
    model: route.model,
    apiKey: route.apiKey,
    envKey: route.envKey,
  };
}

export function listProviderPresets() {
  return Object.entries(PROVIDER_PRESETS).map(([id, p]) => ({
    id,
    name: p.name,
    baseUrl: p.baseUrl,
    model: p.model,
    envKey: p.envKey,
  }));
}

export { listProviders, listModels, resolveProviderRoute };
