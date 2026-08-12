/**
 * Connected-app OAuth provider definitions (browser login).
 */
export const CONNECTED_OAUTH_PROVIDERS = {
  github: {
    id: "github",
    name: "GitHub",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    // GitHub OAuth Apps: client id is public; secret recommended for web apps.
    // For CLI PKCE-style local apps, register callback http://127.0.0.1:<port>/auth/callback
    defaultScopes: "read:user repo",
    envClientId: "XCLAW_GITHUB_OAUTH_CLIENT_ID",
    envClientSecret: "XCLAW_GITHUB_OAUTH_CLIENT_SECRET",
    // GitHub does not fully support PKCE on all app types; we still send challenge.
    // Classic OAuth Apps exchange with client_secret when present.
    docs: "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps",
  },
  google: {
    id: "google",
    name: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    defaultScopes: "openid email profile",
    envClientId: "XCLAW_GOOGLE_OAUTH_CLIENT_ID",
    envClientSecret: "XCLAW_GOOGLE_OAUTH_CLIENT_SECRET",
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
    docs: "https://developers.google.com/identity/protocols/oauth2/native-app",
  },
};

export function getConnectedOAuthProvider(id) {
  return CONNECTED_OAUTH_PROVIDERS[String(id || "").toLowerCase()] || null;
}

export function listConnectedOAuthProviders() {
  return Object.values(CONNECTED_OAUTH_PROVIDERS).map((p) => ({
    id: p.id,
    name: p.name,
    scopes: p.defaultScopes,
    docs: p.docs,
    envClientId: p.envClientId,
  }));
}
