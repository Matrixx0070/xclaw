/**
 * Provider management core — the shared model behind `xclaw providers …` (CLI)
 * and the gateway `/providers/*` management routes + control-UI panel.
 *
 * Separation of concerns:
 *   - SECRETS (api keys, OAuth tokens) live in the per-provider auth-profile
 *     store (src/auth/profiles.mjs) — never written to xclaw.json.
 *   - ENDPOINTS (per-provider baseUrl) + the ACTIVE selection (agent.provider /
 *     agent.model) live in xclaw.json via saveConfigPatch.
 *
 * Every function here is pure-ish (reads/writes the stores, no I/O beyond that)
 * so both transports share identical behavior.
 */
import { BUILTIN_PROVIDERS, listProviders } from "./registry.mjs";
import { listProfiles, resolveProviderToken } from "../auth/profiles.mjs";
import { saveConfigPatch } from "../config/load.mjs";

/** Providers a user can meaningfully configure (skip the internal "compatible" catch-all in listings but still allow it explicitly). */
export function manageableProviderIds(cfg = {}) {
  const builtin = Object.keys(BUILTIN_PROVIDERS).filter((id) => id !== "compatible");
  const custom = Object.keys(cfg.providers || {}).filter(
    (id) => id !== "routes" && !builtin.includes(id)
  );
  return [...builtin, ...custom];
}

/** Default (registry) baseUrl for a provider id. */
export function defaultBaseUrl(cfg, id) {
  const all = listProviders(cfg);
  return all[id]?.baseUrl || BUILTIN_PROVIDERS[id]?.baseUrl || null;
}

/**
 * Full inventory: one row per provider with endpoint + credential + active
 * status. Secrets are never included — only booleans + profile ids.
 * @returns {Promise<{ active: {provider,model}, providers: object[] }>}
 */
export async function providerInventory(cfg = {}) {
  const ids = manageableProviderIds(cfg);
  const all = listProviders(cfg);
  const rows = [];
  for (const id of ids) {
    const def = all[id] || BUILTIN_PROVIDERS[id] || {};
    const profiles = await listProfiles(cfg, id);
    const customBase = cfg.providers?.[id]?.baseUrl || null;
    const envKey = def.envKey || null;
    const hasEnvKey = Boolean(envKey && process.env[envKey]);
    const oauthProfiles = profiles.filter((p) => p.mode === "oauth");
    const keyProfiles = profiles.filter((p) => p.mode !== "oauth" && p.hasSecret);
    // Ollama routes to its cloud endpoint when a key is present (see
    // registry.ollamaEffectiveDefault) — show the endpoint requests actually go to.
    const hasAnyKey = keyProfiles.length > 0 || hasEnvKey;
    const effectiveDefault =
      id === "ollama" && hasAnyKey
        ? process.env.OLLAMA_CLOUD_BASE_URL || "https://ollama.com/v1"
        : def.baseUrl || null;
    rows.push({
      id,
      name: def.name || id,
      baseUrl: customBase || effectiveDefault || null,
      baseUrlDefault: effectiveDefault || null,
      baseUrlCustom: Boolean(customBase),
      envKey,
      hasEnvKey,
      hasKey: keyProfiles.length > 0 || hasEnvKey,
      hasOAuth: oauthProfiles.length > 0,
      oauthExpired: oauthProfiles.length > 0 && oauthProfiles.every((p) => p.expired),
      profiles: profiles.map((p) => ({
        id: p.id,
        mode: p.mode,
        expired: p.expired,
        orderIndex: p.orderIndex,
      })),
      configured: keyProfiles.length > 0 || oauthProfiles.length > 0 || hasEnvKey || Boolean(customBase),
      models: (def.models || []).map((m) => (typeof m === "string" ? m : m.id)).slice(0, 40),
      defaultModel: def.defaultModel || null,
      isActive: (cfg.agent?.provider || null) === id,
    });
  }
  return {
    active: { provider: cfg.agent?.provider || null, model: cfg.agent?.model || null },
    providers: rows,
  };
}

/** Set (or clear, with url=null) a provider's base URL in xclaw.json. */
export async function setProviderBaseUrl(id, url) {
  if (!id) throw new Error("provider id required");
  const value = url && String(url).trim() ? String(url).trim().replace(/\/$/, "") : null;
  await saveConfigPatch({ providers: { [id]: { baseUrl: value } } });
  return { ok: true, provider: id, baseUrl: value };
}

/**
 * Select the active provider + model (writes agent.provider/model, clears the
 * stale agent.baseUrl so the per-provider endpoint is used). Optionally records
 * the preferred auth profile order so a chosen profile wins.
 */
export async function setActiveProvider(cfg, { provider, model } = {}) {
  if (!provider) throw new Error("provider required");
  const ids = manageableProviderIds(cfg);
  if (!ids.includes(provider)) throw new Error(`unknown provider: ${provider}`);
  const def = listProviders(cfg)[provider] || BUILTIN_PROVIDERS[provider] || {};
  const chosenModel = model || cfg.agent?.model || def.defaultModel || null;
  const patch = {
    agent: { provider, model: chosenModel, baseUrl: null },
  };
  await saveConfigPatch(patch);
  return { ok: true, provider, model: chosenModel };
}

/**
 * Live credential check for a provider — does a usable key/token resolve right
 * now (env, profile, or refreshable OAuth)? Never returns the secret.
 */
export async function checkProviderCredential(cfg, provider) {
  try {
    const tok = await resolveProviderToken(cfg, provider, {});
    return { ok: Boolean(tok.token), source: tok.source || null };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

export default {
  manageableProviderIds,
  defaultBaseUrl,
  providerInventory,
  setProviderBaseUrl,
  setActiveProvider,
  checkProviderCredential,
};
