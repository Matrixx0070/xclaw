/**
 * Browser OAuth login for connected apps → token store.
 */
import { browserAuthorizationCodePkce } from "../auth/oauth-browser.mjs";
import { getConnectedOAuthProvider, listConnectedOAuthProviders } from "./oauth-providers.mjs";
import { setAppToken, listConnectedApps } from "./token-store.mjs";
import { refreshAppToken } from "./token-refresh.mjs";

function resolveClient(provider, opts = {}) {
  const clientId =
    opts.clientId ||
    process.env[provider.envClientId] ||
    process.env[`XCLAW_${provider.id.toUpperCase()}_CLIENT_ID`];
  const clientSecret =
    opts.clientSecret ||
    process.env[provider.envClientSecret] ||
    process.env[`XCLAW_${provider.id.toUpperCase()}_CLIENT_SECRET`] ||
    "";
  return { clientId, clientSecret };
}

/**
 * @param {object} cfg
 * @param {string} appId github | google | …
 * @param {object} [opts]
 */
export async function loginConnectedOAuth(cfg, appId, opts = {}) {
  const provider = getConnectedOAuthProvider(appId);
  if (!provider) {
    return {
      ok: false,
      error: `Unknown connected OAuth app: ${appId}. Known: ${listConnectedOAuthProviders()
        .map((p) => p.id)
        .join(", ")}`,
      providers: listConnectedOAuthProviders(),
    };
  }

  const { clientId, clientSecret } = resolveClient(provider, opts);
  if (!clientId) {
    return {
      ok: false,
      error:
        `Set ${provider.envClientId} (OAuth App client id). ` +
        `Register redirect URI http://127.0.0.1:<port>/auth/callback on the provider. ` +
        (provider.docs ? `Docs: ${provider.docs}` : ""),
      provider: provider.id,
      envClientId: provider.envClientId,
    };
  }

  const port = opts.redirectPort || Number(process.env.XCLAW_OAUTH_CALLBACK_PORT) || 8765;
  const scope = opts.scope || provider.defaultScopes;

  const result = await browserAuthorizationCodePkce({
    authorizeUrl: provider.authorizeUrl,
    tokenUrl: provider.tokenUrl,
    clientId,
    clientSecret: clientSecret || undefined,
    scope,
    redirectPort: port,
    redirectPath: "/auth/callback",
    extraAuthorizeParams: provider.extraAuthorizeParams || {},
    timeoutMs: opts.timeoutMs || 180_000,
  });

  if (!result.ok) {
    return { ok: false, error: result.error, provider: provider.id, detail: result };
  }

  const expiresAt =
    result.expiresIn != null
      ? new Date(Date.now() + Number(result.expiresIn) * 1000).toISOString()
      : null;

  await setAppToken(cfg, provider.id, {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    tokenType: result.tokenType,
    scope: result.scope,
    expiresAt,
    source: "oauth_browser",
    clientId,
  });

  return {
    ok: true,
    provider: provider.id,
    scope: result.scope,
    expiresAt,
    hasRefreshToken: Boolean(result.refreshToken),
    redirectUri: result.redirectUri,
  };
}

export async function refreshConnectedOAuth(cfg, appId, opts = {}) {
  const out = await refreshAppToken(cfg, appId, opts);
  if (!out.ok) return out;
  return { ok: true, provider: out.provider, expiresAt: out.expiresAt };
}

export async function connectedAuthStatus(cfg) {
  const apps = await listConnectedApps(cfg);
  const providers = listConnectedOAuthProviders();
  return { apps, oauthProviders: providers };
}


export async function logoutConnected(cfg, appId) {
  const { deleteAppToken } = await import("./token-store.mjs");
  if (!appId || appId === "all" || appId === "*") {
    const { loadTokens, saveTokens } = await import("./token-store.mjs");
    const data = await loadTokens(cfg);
    const ids = Object.keys(data.apps || {});
    data.apps = {};
    await saveTokens(cfg, data);
    return { ok: true, deleted: ids };
  }
  return deleteAppToken(cfg, appId);
}
