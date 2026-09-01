/**
 * Auth profiles — OpenClaw-style credential sink for XClaw (Phase 1).
 *
 * Modes: api_key | token | oauth
 * Store: ~/.xclaw/agents/<agentId>/auth-profiles.json  (default agent: main)
 * Resolve order: config → profile order → env → credentials.json → grok-cli
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const PROFILE_VERSION = 1;

function stateDir(cfg) {
  return cfg?.paths?.configDir || process.env.XCLAW_STATE_DIR || path.join(os.homedir(), ".xclaw");
}

export function defaultAgentId(cfg) {
  return cfg?.agent?.id || cfg?.agents?.default || process.env.XCLAW_AGENT_ID || "main";
}

export function profilesPath(cfg, agentId) {
  const id = agentId || defaultAgentId(cfg);
  return path.join(stateDir(cfg), "agents", id, "auth-profiles.json");
}

async function withFileLock(lockPath, fn) {
  const lockFile = `${lockPath}.lock`;
  const start = Date.now();
  for (;;) {
    try {
      const fh = await fs.open(lockFile, "wx");
      await fh.writeFile(String(process.pid));
      await fh.close();
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      if (Date.now() - start > 10_000) {
        try {
          await fs.unlink(lockFile);
        } catch {
          /* */
        }
        continue;
      }
      await new Promise((r) => setTimeout(r, 25 + Math.random() * 50));
    }
  }
  try {
    return await fn();
  } finally {
    try {
      await fs.unlink(lockFile);
    } catch {
      /* */
    }
  }
}

export async function loadProfiles(cfg, agentId) {
  const fp = profilesPath(cfg, agentId);
  try {
    const raw = JSON.parse(await fs.readFile(fp, "utf8"));
    return {
      version: raw.version || PROFILE_VERSION,
      order: raw.order || {},
      profiles: raw.profiles || {},
      path: fp,
    };
  } catch {
    return { version: PROFILE_VERSION, order: {}, profiles: {}, path: fp };
  }
}

export async function saveProfiles(cfg, data, agentId) {
  const fp = profilesPath(cfg, agentId);
  await fs.mkdir(path.dirname(fp), { recursive: true });
  const out = {
    version: PROFILE_VERSION,
    order: data.order || {},
    profiles: data.profiles || {},
    updatedAt: new Date().toISOString(),
  };
  return withFileLock(fp, async () => {
    await fs.writeFile(fp, JSON.stringify(out, null, 2), { mode: 0o600 });
    try {
      await fs.chmod(fp, 0o600);
    } catch {
      /* windows */
    }
    return fp;
  });
}

function profileId(provider, name = "default") {
  const p = String(provider || "xai").toLowerCase();
  const n = String(name || "default").replace(/[^a-zA-Z0-9._@+-]/g, "_");
  return `${p}:${n}`;
}

const ENV_KEYS = {
  xai: ["XAI_API_KEY", "XCLAW_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN"],
  openrouter: ["OPENROUTER_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  groq: ["GROQ_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  together: ["TOGETHER_API_KEY"],
  ollama: ["OLLAMA_API_KEY"],
  compatible: ["XCLAW_API_KEY", "OPENAI_API_KEY"],
};

export function envKeysForProvider(provider) {
  return ENV_KEYS[provider] || ["XCLAW_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY"];
}

/**
 * Upsert API key profile.
 */
export async function loginApiKey(cfg, { provider = "xai", name = "default", apiKey, setDefault = true } = {}) {
  if (!apiKey || !String(apiKey).trim()) throw new Error("apiKey required");
  const id = profileId(provider, name);
  const store = await loadProfiles(cfg);
  store.profiles[id] = {
    provider: String(provider).toLowerCase(),
    mode: "api_key",
    apiKey: String(apiKey).trim(),
    createdAt: store.profiles[id]?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (setDefault) {
    const order = store.order[provider] || [];
    store.order[provider] = [id, ...order.filter((x) => x !== id)];
  }
  const pathOut = await saveProfiles(cfg, store);
  // keep legacy credentials mirror for xai
  if (provider === "xai") {
    try {
      const { loginWithApiKey } = await import("./xai.mjs");
      await loginWithApiKey(cfg, apiKey);
    } catch {
      /* */
    }
  }
  return { ok: true, profileId: id, path: pathOut, mode: "api_key" };
}

/**
 * Upsert static token profile (e.g. Anthropic setup-token style).
 */
export async function loginToken(cfg, { provider = "anthropic", name = "default", token, setDefault = true } = {}) {
  if (!token || !String(token).trim()) throw new Error("token required");
  const id = profileId(provider, name);
  const store = await loadProfiles(cfg);
  store.profiles[id] = {
    provider: String(provider).toLowerCase(),
    mode: "token",
    token: String(token).trim(),
    createdAt: store.profiles[id]?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (setDefault) {
    const order = store.order[provider] || [];
    store.order[provider] = [id, ...order.filter((x) => x !== id)];
  }
  const pathOut = await saveProfiles(cfg, store);
  return { ok: true, profileId: id, path: pathOut, mode: "token" };
}

/**
 * Upsert OAuth profile tokens (after PKCE exchange elsewhere).
 */
export async function loginOAuthTokens(
  cfg,
  {
    provider = "xai",
    name = "default",
    accessToken,
    refreshToken = null,
    expiresAt = null,
    expiresIn = null,
    setDefault = true,
    meta = {},
  } = {}
) {
  if (!accessToken) throw new Error("accessToken required");
  const id = profileId(provider, name);
  const store = await loadProfiles(cfg);
  let exp = expiresAt;
  if (!exp && expiresIn) {
    exp = new Date(Date.now() + Number(expiresIn) * 1000).toISOString();
  }
  store.profiles[id] = {
    provider: String(provider).toLowerCase(),
    mode: "oauth",
    accessToken,
    refreshToken: refreshToken || null,
    expiresAt: exp || null,
    meta: meta || {},
    createdAt: store.profiles[id]?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (setDefault) {
    const order = store.order[provider] || [];
    store.order[provider] = [id, ...order.filter((x) => x !== id)];
  }
  const pathOut = await saveProfiles(cfg, store);
  return { ok: true, profileId: id, path: pathOut, mode: "oauth", expiresAt: exp };
}

export async function removeProfile(cfg, profileIdOrProvider, name) {
  const store = await loadProfiles(cfg);
  const id =
    profileIdOrProvider.includes(":")
      ? profileIdOrProvider
      : profileId(profileIdOrProvider, name || "default");
  if (!store.profiles[id]) return { ok: false, error: "not found", profileId: id };
  const provider = store.profiles[id].provider;
  delete store.profiles[id];
  if (store.order[provider]) {
    store.order[provider] = store.order[provider].filter((x) => x !== id);
  }
  await saveProfiles(cfg, store);
  return { ok: true, profileId: id };
}

export async function setAuthOrder(cfg, provider, profileIds = []) {
  const store = await loadProfiles(cfg);
  const p = String(provider).toLowerCase();
  for (const id of profileIds) {
    if (!store.profiles[id]) throw new Error(`unknown profile: ${id}`);
  }
  store.order[p] = [...profileIds];
  await saveProfiles(cfg, store);
  return { ok: true, provider: p, order: store.order[p] };
}

export async function getAuthOrder(cfg, provider) {
  const store = await loadProfiles(cfg);
  const p = String(provider).toLowerCase();
  return {
    provider: p,
    order: store.order[p] || Object.keys(store.profiles).filter((k) => store.profiles[k].provider === p),
  };
}

export async function listProfiles(cfg, provider = null) {
  const store = await loadProfiles(cfg);
  let ids = Object.keys(store.profiles);
  if (provider) {
    const p = String(provider).toLowerCase();
    ids = ids.filter((id) => store.profiles[id].provider === p);
  }
  return ids.map((id) => redactProfile(id, store.profiles[id], store.order));
}

function redactProfile(id, p, orderMap = {}) {
  const order = orderMap[p.provider] || [];
  return {
    id,
    provider: p.provider,
    mode: p.mode,
    hasSecret: Boolean(p.apiKey || p.token || p.accessToken),
    expiresAt: p.expiresAt || null,
    expired: p.expiresAt ? Date.now() > Date.parse(p.expiresAt) : false,
    orderIndex: order.indexOf(id),
    updatedAt: p.updatedAt || null,
  };
}

/**
 * Extract bearer credential from a profile (refresh oauth if needed).
 */
/**
 * profile.expiresAt is written inconsistently across writers: the OAuth
 * exchange/refresh paths (anthropic-oauth.mjs) store a raw epoch-ms NUMBER;
 * refreshProfileOAuth below stores an ISO STRING. Date.parse() only handles
 * the string form — called on a number it returns NaN, and any comparison
 * against NaN is false, so a numeric expiresAt silently never looked expired
 * (real incident: an anthropic:oauth token sat expired for 9 hours because
 * this check never fired). Accept both shapes.
 */
function parseExpiresAtMs(expiresAt) {
  if (expiresAt == null) return null;
  if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) return expiresAt;
  if (typeof expiresAt === "string") {
    if (/^\d+$/.test(expiresAt.trim())) return Number(expiresAt.trim());
    const parsed = Date.parse(expiresAt);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Re-read after unbounded refresh fetch. removeProfile / loginApiKey /
 * loginToken / clearAllProfiles are concurrent writers of the same
 * auth-profiles.json. Save of the stale whole-store snapshot must not
 * resurrect a removed profile — or overwrite a concurrent api_key.
 *
 * missing heldStore → null
 * missing onDisk → null (do not resurrect the file)
 * missing heldStore.profiles[id] → null
 * missing onDisk.profiles[id] → null (this profile was removed)
 * onDisk mode is a non-oauth replacement → null
 * else overlay heldStore.profiles[id] onto onDisk so other-profile
 * removes / logins survive
 */
export function settleAfterProfileRefresh(heldStore, onDisk, profileId) {
  if (!heldStore) return null;
  if (!onDisk) return null;
  if (!heldStore.profiles?.[profileId]) return null;
  if (!onDisk.profiles?.[profileId]) return null;
  const diskMode = onDisk.profiles[profileId].mode;
  if (diskMode && diskMode !== "oauth") return null;
  return {
    ...onDisk,
    profiles: {
      ...onDisk.profiles,
      [profileId]: heldStore.profiles[profileId],
    },
  };
}

async function persistRefreshedProfile(cfg, store, id, profile) {
  store.profiles[id] = profile;
  const onDisk = await loadProfiles(cfg);
  const settled = settleAfterProfileRefresh(store, onDisk, id);
  if (!settled) return null;
  await saveProfiles(cfg, settled);
  return profile;
}

export async function credentialFromProfile(cfg, profile, store, profileIdStr) {
  if (!profile) return null;
  if (profile.mode === "api_key" && profile.apiKey) {
    return { token: profile.apiKey, source: `profile:${profileIdStr}`, mode: "api_key", profileId: profileIdStr };
  }
  if (profile.mode === "token" && profile.token) {
    return { token: profile.token, source: `profile:${profileIdStr}`, mode: "token", profileId: profileIdStr };
  }
  if (profile.mode === "oauth" && profile.accessToken) {
    const expiresAtMs = parseExpiresAtMs(profile.expiresAt);
    if (expiresAtMs != null && Date.now() > expiresAtMs - 30_000) {
      if (profile.refreshToken) {
        try {
          const refreshed = await refreshProfileOAuth(cfg, store, profileIdStr, profile);
          if (!refreshed?.accessToken) {
            return {
              token: null,
              source: `profile:${profileIdStr}`,
              mode: "oauth",
              profileId: profileIdStr,
              error: "oauth token expired",
            };
          }
          return {
            token: refreshed.accessToken,
            source: `profile:${profileIdStr}:refresh`,
            mode: "oauth",
            profileId: profileIdStr,
          };
        } catch (err) {
          return {
            token: null,
            source: `profile:${profileIdStr}`,
            mode: "oauth",
            profileId: profileIdStr,
            error: err.message || "refresh failed",
          };
        }
      }
      return {
        token: null,
        source: `profile:${profileIdStr}`,
        mode: "oauth",
        profileId: profileIdStr,
        error: "oauth token expired",
      };
    }
    return {
      token: profile.accessToken,
      source: `profile:${profileIdStr}`,
      mode: "oauth",
      profileId: profileIdStr,
    };
  }
  return null;
}

/**
 * Refresh dispatch is provider-aware: xAI (and anything else using the
 * generic client_id + form-encoded grant) goes through the inline path
 * below; Anthropic has its own token endpoint, JSON body shape, and fixed
 * Claude Code client id, so it must go through anthropic-oauth.mjs's own
 * refresher (real incident: this used to fall through to the xAI defaults
 * — auth.x.ai/oauth/token with no client id configured — for an anthropic
 * profile, which either 400'd or, combined with the expiry-check bug above,
 * never even ran).
 */
export async function refreshProfileOAuth(cfg, store, id, profile) {
  if (profile.provider === "anthropic") {
    // Lazy import: anthropic-oauth.mjs imports from this module.
    const { refreshAnthropicOAuthToken } = await import("./anthropic-oauth.mjs");
    const out = await refreshAnthropicOAuthToken({
      refreshToken: profile.refreshToken,
      clientId: profile.meta?.clientId,
      tokenUrl: profile.meta?.tokenUrl,
      scope: profile.meta?.scope,
    });
    if (!out.ok) throw new Error(out.error || "anthropic refresh failed");
    profile.accessToken = out.accessToken;
    if (out.refreshToken) profile.refreshToken = out.refreshToken;
    profile.expiresAt = out.expiresAt;
    profile.updatedAt = new Date().toISOString();
    return persistRefreshedProfile(cfg, store, id, profile);
  }

  const tokenUrl =
    profile.meta?.tokenUrl ||
    process.env.XCLAW_XAI_OAUTH_TOKEN_URL ||
    process.env.XCLAW_OAUTH_TOKEN_URL ||
    "https://auth.x.ai/oauth/token";
  const clientId =
    profile.meta?.clientId ||
    process.env.XCLAW_XAI_OAUTH_CLIENT_ID ||
    process.env.XCLAW_OAUTH_CLIENT_ID;
  if (!clientId) throw new Error("oauth client id missing for refresh");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: profile.refreshToken,
    client_id: clientId,
  });
  const r = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const tok = await r.json().catch(() => ({}));
  if (!r.ok || !tok.access_token) throw new Error(tok.error || `refresh HTTP ${r.status}`);
  profile.accessToken = tok.access_token;
  if (tok.refresh_token) profile.refreshToken = tok.refresh_token;
  if (tok.expires_in) {
    profile.expiresAt = new Date(Date.now() + Number(tok.expires_in) * 1000).toISOString();
  }
  profile.updatedAt = new Date().toISOString();
  return persistRefreshedProfile(cfg, store, id, profile);
}

/**
 * Resolve bearer token for a provider using full priority chain.
 */
export async function resolveProviderToken(cfg = {}, provider = "xai", opts = {}) {
  const p = String(provider || "xai").toLowerCase();

  // 1. explicit config — but cfg.agent.apiKey belongs to the ACTIVE provider
  //    (loadConfig caches the active provider's token there). Only hand it back
  //    when the requested provider matches, or when no active provider is set
  //    (a genuinely generic key). The old `|| p === "xai"` default-to-xai clause
  //    leaked one provider's key (e.g. an Anthropic OAuth token) to another.
  //
  //    opts.freshOAuth bypasses this cache: the cached token is a boot-time
  //    snapshot and OAuth tokens expire (~8h), so a long-running caller must
  //    force resolution down to the profile branch below, which checks expiry
  //    and refreshes. (Without this, a gateway up past the token lifetime
  //    keeps returning the dead cached token — the 2026-08-13 outage.)
  if (
    !opts.freshOAuth &&
    cfg.agent?.apiKey &&
    (!cfg.agent?.provider || cfg.agent.provider === p)
  ) {
    return {
      token: cfg.agent.apiKey,
      source: cfg.agent.authSource || "config.agent.apiKey",
      mode: cfg.agent.authMode || "api_key",
    };
  }

  // 2. preferred profile id — but ONLY when that profile belongs to the
  //    requested provider. cfg.agent.authProfileId is the ACTIVE provider's
  //    profile (loadConfig sets it); honoring it for a different provider
  //    shipped one vendor's token to another (Anthropic OAuth → xai endpoint).
  const store = await loadProfiles(cfg, opts.agentId);
  if (
    opts.profileId &&
    store.profiles[opts.profileId] &&
    store.profiles[opts.profileId].provider === p
  ) {
    const cred = await credentialFromProfile(cfg, store.profiles[opts.profileId], store, opts.profileId);
    if (cred?.token) return cred;
    if (cred?.error) return cred;
  }

  // 3. ordered profiles
  const order =
    store.order[p] ||
    Object.keys(store.profiles).filter((id) => store.profiles[id].provider === p);
  let lastProfileError = null;
  for (const id of order) {
    const cred = await credentialFromProfile(cfg, store.profiles[id], store, id);
    if (cred?.token) return cred;
    if (cred?.error) lastProfileError = cred;
  }

  // 4. env
  for (const k of envKeysForProvider(p)) {
    if (process.env[k]) {
      return { token: process.env[k], source: `env:${k}`, mode: "api_key" };
    }
  }

  // 5. legacy credentials.json (xai)
  if (p === "xai") {
    try {
      const { resolveXaiToken } = await import("./xai.mjs");
      // avoid recursion: temporarily strip agent.apiKey already checked
      const r = await resolveXaiToken({
        ...cfg,
        agent: { ...(cfg.agent || {}), apiKey: undefined },
        _skipProfiles: true,
      });
      // resolveXaiToken may still hit env — only accept credentials/grok sources
      if (r.token && (r.source?.startsWith("credentials") || r.source === "grok-cli" || r.source === "oauth.refresh")) {
        return { token: r.token, source: r.source, mode: r.source.includes("oauth") ? "oauth" : "api_key" };
      }
      if (r.token && r.source === "env") {
        // already handled env above; ignore
      } else if (r.token && r.source !== "config.agent.apiKey") {
        return { token: r.token, source: r.source, mode: "api_key" };
      }
    } catch {
      /* */
    }
  }

  // 6. grok-cli session (xai only)
  if (p === "xai") {
    try {
      const grokAuth = path.join(os.homedir(), ".grok", "auth.json");
      const raw = JSON.parse(await fs.readFile(grokAuth, "utf8"));
      const tok = raw.access_token || raw.accessToken || raw.token || raw.session;
      if (tok) return { token: tok, source: "grok-cli", mode: "oauth" };
    } catch {
      /* */
    }
  }

  if (lastProfileError) {
    return {
      token: null,
      source: lastProfileError.source || "none",
      mode: lastProfileError.mode || null,
      profileId: lastProfileError.profileId || null,
      error: lastProfileError.error,
    };
  }
  return { token: null, source: "none", mode: null };
}

/**
 * Full auth status for CLI / doctor.
 */
export async function modelsAuthStatus(cfg, provider = null) {
  const store = await loadProfiles(cfg);
  const providers = provider
    ? [String(provider).toLowerCase()]
    : [...new Set([...Object.keys(store.order), ...Object.values(store.profiles).map((x) => x.provider), "xai", "openai", "anthropic"])];

  const results = [];
  for (const p of providers) {
    const resolved = await resolveProviderToken(cfg, p);
    results.push({
      provider: p,
      hasToken: Boolean(resolved.token),
      source: resolved.source,
      mode: resolved.mode || null,
      profileId: resolved.profileId || null,
      error: resolved.error || null,
      profiles: await listProfiles(cfg, p),
      order: (await getAuthOrder(cfg, p)).order,
    });
  }
  return {
    at: new Date().toISOString(),
    agentId: defaultAgentId(cfg),
    path: store.path,
    providers: results,
  };
}

export function makeProfileId(provider, name = "default") {
  return profileId(provider, name);
}

/** test helper */
export async function clearAllProfiles(cfg) {
  const fp = profilesPath(cfg);
  try {
    await fs.unlink(fp);
  } catch {
    /* */
  }
  return { ok: true };
}
