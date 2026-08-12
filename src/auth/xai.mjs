/**
 * xAI authentication for XClaw.
 *
 * Public xAI inference API uses API keys (Bearer), not a documented public
 * OAuth client for third-party apps. This module supports:
 *  1. API key store (recommended / supported)
 *  2. Session / access token from env or Grok CLI cache
 *  3. Optional OAuth2 PKCE when XCLAW_XAI_OAUTH_CLIENT_ID is configured
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import http from "node:http";
import { URL } from "node:url";

function credPath(cfg) {
  const base = cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw");
  return path.join(base, "credentials.json");
}

export async function loadCredentials(cfg) {
  try {
    return JSON.parse(await fs.readFile(credPath(cfg), "utf8"));
  } catch {
    return {};
  }
}

export async function saveCredentials(cfg, data) {
  const fp = credPath(cfg);
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    await fs.chmod(fp, 0o600);
  } catch {
    /* windows */
  }
  return fp;
}

export async function resolveXaiToken(cfg = {}) {
  if (cfg.agent?.apiKey) {
    return { token: cfg.agent.apiKey, source: "config.agent.apiKey" };
  }
  const envKey =
    process.env.XAI_API_KEY ||
    process.env.XCLAW_API_KEY ||
    process.env.OPENAI_API_KEY;
  if (envKey) return { token: envKey, source: "env" };

  const creds = await loadCredentials(cfg);
  if (creds.xaiApiKey) return { token: creds.xaiApiKey, source: "credentials.xaiApiKey" };
  if (creds.accessToken) {
    if (creds.expiresAt && Date.now() > Date.parse(creds.expiresAt)) {
      if (creds.refreshToken) {
        try {
          const refreshed = await refreshOAuthToken(cfg, creds);
          return { token: refreshed.accessToken, source: "oauth.refresh" };
        } catch {
          /* fall through */
        }
      }
      return { token: null, source: "expired", error: "oauth token expired" };
    }
    return { token: creds.accessToken, source: "credentials.accessToken" };
  }

  try {
    const grokAuth = path.join(os.homedir(), ".grok", "auth.json");
    const raw = JSON.parse(await fs.readFile(grokAuth, "utf8"));
    const tok = raw.access_token || raw.accessToken || raw.token || raw.session;
    if (tok) return { token: tok, source: "grok-cli" };
  } catch {
    /* */
  }

  return { token: null, source: "none" };
}

export async function loginWithApiKey(cfg, apiKey) {
  if (!apiKey || !String(apiKey).trim()) throw new Error("api key required");
  const creds = await loadCredentials(cfg);
  creds.xaiApiKey = String(apiKey).trim();
  creds.updatedAt = new Date().toISOString();
  const fp = await saveCredentials(cfg, creds);
  return { ok: true, path: fp, source: "api_key" };
}

export async function logout(cfg) {
  try {
    await fs.unlink(credPath(cfg));
  } catch {
    /* */
  }
  return { ok: true };
}

export async function authStatus(cfg) {
  const resolved = await resolveXaiToken(cfg);
  const creds = await loadCredentials(cfg);
  return {
    hasToken: Boolean(resolved.token),
    source: resolved.source,
    error: resolved.error || null,
    hasStoredApiKey: Boolean(creds.xaiApiKey),
    hasOAuth: Boolean(creds.accessToken),
    expiresAt: creds.expiresAt || null,
    oauthConfigured: Boolean(
      process.env.XCLAW_XAI_OAUTH_CLIENT_ID || cfg.auth?.xai?.clientId
    ),
  };
}

function base64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function pkcePair() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export async function loginWithOAuth(cfg, opts = {}) {
  const { canStartOAuth } = await import("./oauth-policy.mjs");
  const gate = canStartOAuth("xai");
  if (!gate.ok) {
    const err = new Error(gate.reason);
    err.policy = gate.policy;
    throw err;
  }
  const clientId =
    opts.clientId ||
    cfg.auth?.xai?.clientId ||
    process.env.XCLAW_XAI_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "OAuth not configured. Set XCLAW_XAI_OAUTH_CLIENT_ID or use: xclaw auth login --api-key xai-..."
    );
  }
  const authUrl =
    opts.authUrl ||
    cfg.auth?.xai?.authUrl ||
    process.env.XCLAW_XAI_OAUTH_AUTH_URL ||
    "https://auth.x.ai/authorize";
  const tokenUrl =
    opts.tokenUrl ||
    cfg.auth?.xai?.tokenUrl ||
    process.env.XCLAW_XAI_OAUTH_TOKEN_URL ||
    "https://auth.x.ai/oauth/token";
  const scopes =
    opts.scopes ||
    cfg.auth?.xai?.scopes ||
    process.env.XCLAW_XAI_OAUTH_SCOPES ||
    "openid profile";

  const { verifier, challenge } = pkcePair();
  const state = base64url(crypto.randomBytes(16));
  const redirectPort = opts.redirectPort || 8765;
  const redirectUri = `http://127.0.0.1:${redirectPort}/callback`;

  const url = new URL(authUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scopes);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url, `http://127.0.0.1:${redirectPort}`);
        if (u.pathname !== "/callback") {
          res.writeHead(404);
          res.end();
          return;
        }
        if (u.searchParams.get("state") !== state) {
          res.writeHead(400);
          res.end("state mismatch");
          reject(new Error("oauth state mismatch"));
          server.close();
          return;
        }
        const err = u.searchParams.get("error");
        if (err) {
          res.writeHead(400);
          res.end(err);
          reject(new Error(err));
          server.close();
          return;
        }
        const c = u.searchParams.get("code");
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body><h1>XClaw auth OK</h1>You can close this window.</body></html>");
        server.close();
        resolve(c);
      } catch (e) {
        reject(e);
        server.close();
      }
    });
    server.listen(redirectPort, "127.0.0.1");
    console.error(`[xclaw auth] Open browser:\n${url.toString()}\n`);
    import("node:child_process").then(({ spawn }) => {
      const cmd =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "start"
            : "xdg-open";
      try {
        spawn(cmd, [url.toString()], { detached: true, stdio: "ignore" }).unref();
      } catch {
        /* */
      }
    });
    const t = setTimeout(() => {
      server.close();
      reject(new Error("oauth timeout (3m)"));
    }, 180_000);
    if (t.unref) t.unref();
  });

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });
  const clientSecret =
    opts.clientSecret ||
    cfg.auth?.xai?.clientSecret ||
    process.env.XCLAW_XAI_OAUTH_CLIENT_SECRET;
  if (clientSecret) body.set("client_secret", clientSecret);

  const tokRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const tok = await tokRes.json().catch(() => ({}));
  if (!tokRes.ok || !tok.access_token) {
    throw new Error(
      `token exchange failed: ${tok.error || tokRes.status} ${tok.error_description || ""}`
    );
  }

  const creds = await loadCredentials(cfg);
  creds.accessToken = tok.access_token;
  creds.refreshToken = tok.refresh_token || creds.refreshToken || null;
  creds.tokenType = tok.token_type || "Bearer";
  if (tok.expires_in) {
    creds.expiresAt = new Date(Date.now() + Number(tok.expires_in) * 1000).toISOString();
  }
  creds.oauth = { clientId, tokenUrl, authUrl };
  creds.updatedAt = new Date().toISOString();
  const fp = await saveCredentials(cfg, creds);
  return { ok: true, path: fp, source: "oauth", expiresAt: creds.expiresAt };
}

async function refreshOAuthToken(cfg, creds) {
  const tokenUrl =
    creds.oauth?.tokenUrl ||
    process.env.XCLAW_XAI_OAUTH_TOKEN_URL ||
    "https://auth.x.ai/oauth/token";
  const clientId =
    creds.oauth?.clientId || process.env.XCLAW_XAI_OAUTH_CLIENT_ID;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: creds.refreshToken,
    client_id: clientId,
  });
  const r = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const tok = await r.json().catch(() => ({}));
  if (!r.ok || !tok.access_token) throw new Error("refresh failed");
  creds.accessToken = tok.access_token;
  if (tok.refresh_token) creds.refreshToken = tok.refresh_token;
  if (tok.expires_in) {
    creds.expiresAt = new Date(Date.now() + Number(tok.expires_in) * 1000).toISOString();
  }
  await saveCredentials(cfg, creds);
  return creds;
}
