/**
 * Gateway OAuth callback route (extracted from gateway/index.mjs, W2).
 *
 * Paths: GET /oauth/callback · GET /auth/callback — PKCE code exchange for
 * connected-app logins started from the CLI. Behavior byte-preserved from
 * the inline handler (HTML success/error pages, 60s token-exchange timeout).
 */
import { takePending } from "../../connected/oauth-pending.mjs";
import { setAppToken } from "../../connected/token-store.mjs";

/** @returns {Promise<boolean>} true if handled */
export async function tryHandleOAuthCallbackRoute({ p, method, req, res, cfg }) {
  if (!((p === "/oauth/callback" || p === "/auth/callback") && method === "GET")) {
    return false;
  }
  const u = new URL(req.url || "/", "http://local");
  const state = u.searchParams.get("state");
  const code = u.searchParams.get("code");
  const err = u.searchParams.get("error");
  if (err) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end(`<h1>OAuth error</h1><p>${err}</p>`);
    return true;
  }
  if (!state || !code) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("missing state or code");
    return true;
  }
  const pending = await takePending(cfg, state);
  if (!pending) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end("<h1>Unknown or expired OAuth state</h1><p>Retry login from CLI.</p>");
    return true;
  }
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirectUri,
      client_id: pending.clientId,
      code_verifier: pending.verifier,
    });
    if (pending.clientSecret) body.set("client_secret", pending.clientSecret);
    const tokenRes = await fetch(pending.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(60_000),
    });
    const json = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !json.access_token) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(`<h1>Token exchange failed</h1><pre>${JSON.stringify(json).slice(0, 500)}</pre>`);
      return true;
    }
    const expiresAt =
      json.expires_in != null
        ? new Date(Date.now() + Number(json.expires_in) * 1000).toISOString()
        : null;
    await setAppToken(cfg, pending.appId, {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || null,
      expiresAt,
      tokenType: json.token_type || "Bearer",
      scope: json.scope || pending.scope,
      clientId: pending.clientId,
      source: "oauth_gateway_callback",
    });
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      `<html><body style="font-family:system-ui;padding:2rem"><h1>XClaw OAuth OK</h1><p>Connected <b>${pending.appId}</b>. You can close this window.</p></body></html>`
    );
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(e.message || String(e));
  }
  return true;
}

export default { tryHandleOAuthCallbackRoute };
