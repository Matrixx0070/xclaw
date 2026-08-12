/**
 * Generic OAuth 2.0 authorization-code + PKCE browser login (loopback).
 *
 * Opens the system browser, listens on 127.0.0.1:<port>/auth/callback,
 * validates state, exchanges code for tokens.
 */
import http from "node:http";
import { URL } from "node:url";
import { spawn } from "node:child_process";
import { pkcePair, randomState } from "./pkce.mjs";
import { oauthError, withHint, OAuthErrorCode, classifyTokenHttpError } from "./oauth-errors.mjs";
import { withOAuthRetry } from "./oauth-retry.mjs";

function openBrowser(url) {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args =
    process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* user must open manually */
  }
}

/**
 * @param {object} opts
 * @param {string} opts.authorizeUrl
 * @param {string} opts.tokenUrl
 * @param {string} opts.clientId
 * @param {string} [opts.clientSecret] confidential clients only
 * @param {string} [opts.scope]
 * @param {number} [opts.redirectPort]
 * @param {string} [opts.redirectPath]
 * @param {number} [opts.timeoutMs]
 * @param {Record<string,string>} [opts.extraAuthorizeParams]
 * @param {Record<string,string>} [opts.extraTokenParams]
 * @param {(url: string) => void} [opts.onAuthorizeUrl]
 */
export async function browserAuthorizationCodePkce(opts) {
  const {
    authorizeUrl,
    tokenUrl,
    clientId,
    clientSecret,
    scope = "",
    redirectPort = Number(process.env.XCLAW_OAUTH_CALLBACK_PORT) || 8765,
    redirectPath = "/auth/callback",
    timeoutMs = 180_000,
    extraAuthorizeParams = {},
    extraTokenParams = {},
    onAuthorizeUrl,
  } = opts;

  if (!authorizeUrl || !tokenUrl || !clientId) {
    return withHint(oauthError(OAuthErrorCode.MISSING_CONFIG, "authorizeUrl, tokenUrl, and clientId are required"));
  }

  const redirectUri = `http://127.0.0.1:${redirectPort}${redirectPath}`;
  const { verifier, challenge } = pkcePair();
  const state = randomState();

  const url = new URL(authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  if (scope) url.searchParams.set("scope", scope);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  for (const [k, v] of Object.entries(extraAuthorizeParams)) {
    if (v != null) url.searchParams.set(k, String(v));
  }

  const authorizeHref = url.toString();
  if (onAuthorizeUrl) onAuthorizeUrl(authorizeHref);
  else {
    console.error(`[xclaw oauth] Open browser:\n${authorizeHref}\n`);
    console.error(`[xclaw oauth] Waiting for callback on ${redirectUri} …`);
  }
  openBrowser(authorizeHref);

  let code;
  try {
    code = await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        try {
          const u = new URL(req.url || "/", `http://127.0.0.1:${redirectPort}`);
          if (u.pathname !== redirectPath && u.pathname !== "/callback") {
            res.writeHead(404);
            res.end("not found");
            return;
          }
          if (u.searchParams.get("state") !== state) {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("state mismatch");
            server.close();
            reject(new Error("oauth state mismatch"));
            return;
          }
          const err = u.searchParams.get("error");
          if (err) {
            const desc = u.searchParams.get("error_description") || err;
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end(desc);
            server.close();
            reject(new Error(desc));
            return;
          }
          const c = u.searchParams.get("code");
          if (!c) {
            res.writeHead(400);
            res.end("missing code");
            server.close();
            reject(new Error("oauth missing code"));
            return;
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            "<!doctype html><html><body style=\"font-family:system-ui;padding:2rem\">" +
              "<h1>XClaw OAuth OK</h1><p>You can close this window and return to the terminal.</p>" +
              "</body></html>"
          );
          server.close();
          resolve(c);
        } catch (e) {
          try {
            server.close();
          } catch {
            /* */
          }
          reject(e);
        }
      });
      server.on("error", (e) => reject(e));
      server.listen(redirectPort, "127.0.0.1");
      const t = setTimeout(() => {
        try {
          server.close();
        } catch {
          /* */
        }
        reject(new Error(`oauth timeout (${Math.round(timeoutMs / 1000)}s)`));
      }, timeoutMs);
      if (t.unref) t.unref();
    });
  } catch (e) {
    {
    const msg = e.message || String(e);
    let code = OAuthErrorCode.INTERNAL;
    if (/timeout/i.test(msg)) code = OAuthErrorCode.CALLBACK_TIMEOUT;
    if (/state mismatch/i.test(msg)) code = OAuthErrorCode.STATE_MISMATCH;
    if (/EADDRINUSE/i.test(msg)) code = OAuthErrorCode.CALLBACK_PORT_BUSY;
    if (/denied|access_denied/i.test(msg)) code = OAuthErrorCode.PROVIDER_DENIED;
    if (/missing code/i.test(msg)) code = OAuthErrorCode.MISSING_CODE;
    return withHint(oauthError(code, msg, { redirectUri }));
  }
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
    ...extraTokenParams,
  });
  if (clientSecret) body.set("client_secret", clientSecret);

  const exchange = async () => {
    let tokenRes;
    try {
      tokenRes = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      return withHint(
        oauthError(OAuthErrorCode.TOKEN_NETWORK, `token request failed: ${e.message}`, {
          redirectUri,
          retryable: true,
        })
      );
    }

    const text = await tokenRes.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    if (!tokenRes.ok) {
      const code = classifyTokenHttpError(tokenRes.status, json);
      const err = withHint(
        oauthError(code, `token HTTP ${tokenRes.status}: ${text.slice(0, 500)}`, {
          redirectUri,
          body: json,
          httpStatus: tokenRes.status,
          retryable: code !== OAuthErrorCode.REFRESH_INVALID && (tokenRes.status >= 500 || tokenRes.status === 429),
        })
      );
      const ra = tokenRes.headers?.get?.("retry-after");
      if (ra) err.retryAfter = ra;
      return err;
    }

    const accessToken = json.access_token || json.accessToken;
    if (!accessToken) {
      return withHint(
        oauthError(OAuthErrorCode.TOKEN_NO_ACCESS, "no access_token in response", {
          body: json,
          redirectUri,
        })
      );
    }

    return {
      ok: true,
      accessToken,
      refreshToken: json.refresh_token || json.refreshToken || null,
      expiresIn: json.expires_in || null,
      tokenType: json.token_type || "Bearer",
      scope: json.scope || scope || null,
      raw: json,
      redirectUri,
    };
  };

  return withOAuthRetry(exchange, opts.retry === false ? { retries: 0 } : opts.retry || {});
}

/**
 * Refresh access token (confidential or public+PKCE depending on provider).
 */
export async function refreshAccessToken({
  tokenUrl,
  clientId,
  clientSecret,
  refreshToken,
  retry,
}) {
  if (!tokenUrl || !clientId || !refreshToken) {
    return withHint(oauthError(OAuthErrorCode.MISSING_CONFIG, "tokenUrl, clientId, refreshToken required"));
  }

  const attempt = async () => {
    let res;
    try {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      });
      if (clientSecret) body.set("client_secret", clientSecret);
      res = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      return withHint(
        oauthError(OAuthErrorCode.REFRESH_NETWORK, e.message || String(e), {
          retryable: true,
        })
      );
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = classifyTokenHttpError(res.status, json);
      const err = withHint(
        oauthError(code, `refresh HTTP ${res.status}`, {
          body: json,
          httpStatus: res.status,
          reauth: code === OAuthErrorCode.REFRESH_INVALID,
          retryable: code !== OAuthErrorCode.REFRESH_INVALID && (res.status >= 500 || res.status === 429),
        })
      );
      // attach Retry-After if present
      const ra = res.headers?.get?.("retry-after");
      if (ra) err.retryAfter = ra;
      return err;
    }
    return {
      ok: true,
      accessToken: json.access_token,
      refreshToken: json.refresh_token || refreshToken,
      expiresIn: json.expires_in,
      raw: json,
    };
  };

  if (retry === false) return attempt();
  return withOAuthRetry(attempt, typeof retry === "object" ? retry : {});
}
