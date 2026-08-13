/**
 * Gateway provider-management HTTP routes (control-plane for the shared core
 * in src/providers/manage.mjs — same behavior as `xclaw providers …`).
 *
 * Paths (namespaced under /providers/manage so the existing GET /providers/route
 * read in routes/ops.mjs is untouched):
 *   GET    /providers/manage           → full inventory (no secrets, ever)
 *   POST   /providers/manage/base-url  → {provider, url|null} set/clear endpoint
 *   POST   /providers/manage/key       → {provider, apiKey[, name]} store key (never echoed)
 *   POST   /providers/manage/use       → {provider[, model]} select active
 *   POST   /providers/manage/models    → {provider} LIVE model list via the
 *          provider's own /models endpoint (uses the stored credential) — the
 *          UI's dropdown spine: paste key → real models → pick → use
 *   POST   /providers/manage/check     → {provider} live credential resolution
 *   DELETE /providers/manage/key       → {provider | profileId[, name]} remove profile
 *
 *   POST   /providers/manage/oauth/start    → {provider[, name, mode]} begin a
 *          web OAuth flow. Paste-code PKCE providers (anthropic) return
 *          {flow:"paste-code", authorizeUrl, state}; providers whose flow
 *          can't run in a browser round-trip return {flow:"cli", command}.
 *          The PKCE verifier never leaves the gateway (held in memory,
 *          10-minute TTL, single use).
 *   POST   /providers/manage/oauth/complete → {state, code} exchange the
 *          pasted authorization code and store the OAuth profile. Tokens are
 *          never echoed back.
 *
 * (An older note here said OAuth "stays CLI-side" because the gateway was
 * unauthenticated-by-default — stale since 3.86.0: this whole route plane is
 * operator-token gated.)
 *
 * Config writes apply to NEW config loads (running agent loops keep their boot
 * snapshot) — responses say so.
 */
import {
  providerInventory,
  setProviderBaseUrl,
  setActiveProvider,
  checkProviderCredential,
} from "../../providers/manage.mjs";
import { loginApiKey, removeProfile, setAuthOrder, listProfiles } from "../../auth/profiles.mjs";

const APPLIES_NOTE = "applies to new agent runs (running loops keep their boot config)";

// Pending web-OAuth flows: state → { provider, name, built, at }.
// The PKCE verifier lives ONLY here; single-use, TTL-swept, size-capped.
const OAUTH_PENDING = new Map();
const OAUTH_TTL_MS = 10 * 60_000;
const OAUTH_MAX_PENDING = 10;
function sweepOauthPending() {
  const now = Date.now();
  for (const [state, v] of OAUTH_PENDING) {
    if (now - v.at > OAUTH_TTL_MS) OAUTH_PENDING.delete(state);
  }
  while (OAUTH_PENDING.size > OAUTH_MAX_PENDING) {
    const oldest = OAUTH_PENDING.keys().next().value;
    OAUTH_PENDING.delete(oldest);
  }
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * A provider base URL decides where the stored credential is sent as a Bearer
 * header — an arbitrary rewrite is credential exfiltration. Allow only:
 *   https://<any host>            (TLS to a real API host)
 *   http://<loopback>[:port]/...  (local ollama / llama.cpp only)
 * @returns {string|null} error message, or null when acceptable
 */
function baseUrlProblem(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return `invalid URL: ${url}`;
  }
  if (u.protocol === "https:") return null;
  if (u.protocol === "http:") {
    const host = u.hostname.toLowerCase();
    if (LOOPBACK_HOSTS.has(host)) return null;
    return "http:// base URLs are allowed only for loopback hosts (127.0.0.1/localhost/::1) — use https:// for remote APIs";
  }
  return `blocked scheme ${u.protocol} (https, or http to loopback, only)`;
}

/**
 * @param {object} args — standard route args
 * @returns {Promise<boolean>} true if handled
 */
export async function tryHandleProvidersRoute({ p, method, req, res, cfg, json, readBody }) {
  if (!p.startsWith("/providers/manage")) return false;

  try {
    if (p === "/providers/manage" && method === "GET") {
      json(res, 200, await providerInventory(cfg));
      return true;
    }

    if (p === "/providers/manage/base-url" && method === "POST") {
      const body = await readBody(req);
      if (!body.provider) {
        json(res, 400, { error: "provider required" });
        return true;
      }
      const raw = body.url ?? null;
      if (raw !== null && String(raw).trim()) {
        const problem = baseUrlProblem(String(raw).trim());
        if (problem) {
          json(res, 400, { error: problem });
          return true;
        }
      }
      const out = await setProviderBaseUrl(body.provider, raw);
      json(res, 200, { ...out, note: APPLIES_NOTE });
      return true;
    }

    if (p === "/providers/manage/key" && method === "POST") {
      const body = await readBody(req);
      if (!body.provider || !body.apiKey) {
        json(res, 400, { error: "provider and apiKey required" });
        return true;
      }
      // Stored under its own profile name so an API key NEVER clobbers an
      // OAuth login (OAuth lives at "<provider>:default"; keys at
      // "<provider>:apikey") — the two credentials coexist per provider.
      await loginApiKey(cfg, {
        provider: body.provider,
        name: body.name || "apikey",
        apiKey: body.apiKey,
      });
      // Never echo the key back.
      json(res, 200, { ok: true, provider: body.provider, note: APPLIES_NOTE });
      return true;
    }

    if (p === "/providers/manage/use" && method === "POST") {
      const body = await readBody(req);
      const out = await setActiveProvider(cfg, {
        provider: body.provider,
        model: body.model,
      });
      json(res, 200, { ...out, note: APPLIES_NOTE });
      return true;
    }

    if (p === "/providers/manage/models" && method === "POST") {
      const body = await readBody(req);
      if (!body.provider) {
        json(res, 400, { error: "provider required" });
        return true;
      }
      const { fetchLiveModels } = await import("../../providers/discovery.mjs");
      const r = await fetchLiveModels(cfg, body.provider, { force: true });
      json(res, 200, {
        ok: Boolean(r.ok),
        provider: body.provider,
        models: (r.models || []).map((m) => (typeof m === "string" ? m : m.id)),
        error: r.error || null,
      });
      return true;
    }

    if (p === "/providers/manage/check" && method === "POST") {
      const body = await readBody(req);
      if (!body.provider) {
        json(res, 400, { error: "provider required" });
        return true;
      }
      json(res, 200, await checkProviderCredential(cfg, body.provider));
      return true;
    }

    if (p === "/providers/manage/oauth/start" && method === "POST") {
      const body = await readBody(req);
      const provider = String(body.provider || "").toLowerCase();
      if (!provider) {
        json(res, 400, { error: "provider required" });
        return true;
      }
      if (provider === "anthropic" || provider === "claude") {
        const { canStartOAuth } = await import("../../auth/oauth-policy.mjs");
        const gate = canStartOAuth("anthropic");
        if (!gate.ok) {
          json(res, 400, { ok: false, error: gate.reason });
          return true;
        }
        const { buildAnthropicAuthorizeUrl } = await import("../../auth/anthropic-oauth.mjs");
        const built = buildAnthropicAuthorizeUrl({ mode: body.mode });
        sweepOauthPending();
        OAUTH_PENDING.set(built.state, {
          provider: "anthropic",
          name: String(body.name || "oauth"),
          built,
          at: Date.now(),
        });
        json(res, 200, {
          ok: true,
          provider: "anthropic",
          flow: "paste-code",
          authorizeUrl: built.url,
          state: built.state,
          expiresInMs: OAUTH_TTL_MS,
          note: "Open the URL in a browser where you're logged into Claude, approve, then POST the shown code (CODE or CODE#STATE) to oauth/complete.",
        });
        return true;
      }
      // Providers whose flow can't run as a browser paste-code round-trip
      // (xai/openai need env-configured client ids + local callbacks).
      json(res, 200, {
        ok: false,
        provider,
        flow: "cli",
        command: `xclaw providers oauth --provider ${provider}`,
        error: "web OAuth supports anthropic; use the CLI command for this provider",
      });
      return true;
    }

    if (p === "/providers/manage/oauth/complete" && method === "POST") {
      const body = await readBody(req);
      const state = String(body.state || "");
      const pending = OAUTH_PENDING.get(state);
      if (!pending || Date.now() - pending.at > OAUTH_TTL_MS) {
        OAUTH_PENDING.delete(state);
        json(res, 400, { ok: false, error: "oauth flow not found or expired — start again" });
        return true;
      }
      OAUTH_PENDING.delete(state); // single use, even on failure
      const { parsePastedAuthCode, exchangeAnthropicAuthCode } = await import(
        "../../auth/anthropic-oauth.mjs"
      );
      const { loginOAuthTokens } = await import("../../auth/profiles.mjs");
      const { code, state: pastedState } = parsePastedAuthCode(String(body.code || ""));
      if (!code) {
        json(res, 400, { ok: false, error: "empty authorization code" });
        return true;
      }
      const exchanged = await exchangeAnthropicAuthCode({
        ...pending.built,
        code,
        codeVerifier: pending.built.verifier,
        state: pastedState || pending.built.state,
      });
      if (!exchanged.ok) {
        json(res, 400, { ok: false, error: exchanged.error || "code exchange failed" });
        return true;
      }
      const profile = await loginOAuthTokens(cfg, {
        provider: "anthropic",
        name: pending.name,
        accessToken: exchanged.accessToken,
        refreshToken: exchanged.refreshToken,
        expiresAt: exchanged.expiresAt,
        meta: {
          scope: exchanged.scope,
          account: exchanged.account,
          organization: exchanged.organization,
          clientId: pending.built.clientId,
          source: "anthropic-oauth-pkce-web",
        },
      });
      // Tokens are never echoed back — profile id + expiry only.
      json(res, 200, {
        ok: true,
        provider: "anthropic",
        profileId: profile?.profileId || profile?.id || `anthropic:${pending.name}`,
        expiresAt: exchanged.expiresAt,
        note: APPLIES_NOTE,
      });
      return true;
    }

    if (p === "/providers/manage/prefer" && method === "POST") {
      // Choose which stored credential (profile) resolves first for a provider
      // (e.g. prefer "<provider>:apikey" over the "<provider>:default" OAuth).
      const body = await readBody(req);
      if (!body.provider || !body.profileId) {
        json(res, 400, { error: "provider and profileId required" });
        return true;
      }
      const all = await listProfiles(cfg, body.provider);
      const rest = all.map((x) => x.id).filter((id) => id !== body.profileId);
      const out = await setAuthOrder(cfg, body.provider, [body.profileId, ...rest]);
      json(res, 200, { ...out, note: APPLIES_NOTE });
      return true;
    }

    if (p === "/providers/manage/key" && method === "DELETE") {
      const body = await readBody(req).catch(() => ({}));
      const target = body.profileId || body.provider;
      if (!target) {
        json(res, 400, { error: "provider or profileId required" });
        return true;
      }
      const out = await removeProfile(cfg, target, body.name);
      json(res, 200, { ok: true, removed: out?.removed ?? out ?? true });
      return true;
    }
  } catch (err) {
    json(res, 400, { error: err?.message || String(err) });
    return true;
  }

  return false;
}

export default { tryHandleProvidersRoute };
