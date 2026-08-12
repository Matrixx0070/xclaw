/**
 * OpenAI ChatGPT/Codex OAuth PKCE — optional Phase 4 parity with OpenClaw shape.
 * Requires a client_id (set XCLAW_OPENAI_OAUTH_CLIENT_ID). Without it, fails clearly.
 */
import crypto from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import { loginOAuthTokens } from "./profiles.mjs";
import { canStartOAuth } from "./oauth-policy.mjs";

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

export async function loginOpenAICodex(cfg, opts = {}) {
  const gate = canStartOAuth("openai");
  if (!gate.ok) {
    return { ok: false, error: gate.reason, policy: gate.policy };
  }

  const clientId =
    opts.clientId ||
    process.env.XCLAW_OPENAI_OAUTH_CLIENT_ID ||
    cfg.auth?.openai?.clientId;
  if (!clientId) {
    return {
      ok: false,
      error:
        "Set XCLAW_OPENAI_OAUTH_CLIENT_ID to your OpenAI OAuth client id. " +
        "For always-on gateways prefer: xclaw models auth login --provider openai --method api-key --api-key sk-...",
      policy: gate.policy,
    };
  }

  const authUrl = opts.authUrl || process.env.XCLAW_OPENAI_OAUTH_AUTH_URL || "https://auth.openai.com/oauth/authorize";
  const tokenUrl = opts.tokenUrl || process.env.XCLAW_OPENAI_OAUTH_TOKEN_URL || "https://auth.openai.com/oauth/token";
  const scopes = opts.scopes || process.env.XCLAW_OPENAI_OAUTH_SCOPES || "openid profile email offline_access";
  const redirectPort = opts.redirectPort || Number(process.env.XCLAW_OAUTH_CALLBACK_PORT) || 1455;
  const redirectUri = `http://127.0.0.1:${redirectPort}/auth/callback`;

  const { verifier, challenge } = pkcePair();
  const state = base64url(crypto.randomBytes(16));

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
        if (u.pathname !== "/auth/callback" && u.pathname !== "/callback") {
          res.writeHead(404);
          res.end();
          return;
        }
        if (u.searchParams.get("state") !== state) {
          res.writeHead(400);
          res.end("state mismatch");
          server.close();
          reject(new Error("oauth state mismatch"));
          return;
        }
        const err = u.searchParams.get("error");
        if (err) {
          res.writeHead(400);
          res.end(err);
          server.close();
          reject(new Error(err));
          return;
        }
        const c = u.searchParams.get("code");
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body><h1>XClaw OpenAI auth OK</h1>Close this window.</body></html>");
        server.close();
        resolve(c);
      } catch (e) {
        server.close();
        reject(e);
      }
    });
    server.listen(redirectPort, "127.0.0.1");
    console.error(`[xclaw auth] Open browser:\n${url.toString()}\n`);
    import("node:child_process").then(({ spawn }) => {
      const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      try {
        spawn(cmd, [url.toString()], { detached: true, stdio: "ignore" }).unref();
      } catch {
        /* */
      }
    });
    const t = setTimeout(() => {
      server.close();
      reject(new Error("oauth timeout (3m) — paste flow not implemented; retry on a machine with loopback"));
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
  const tokRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const tok = await tokRes.json().catch(() => ({}));
  if (!tokRes.ok || !tok.access_token) {
    return {
      ok: false,
      error: `token exchange failed: ${tok.error || tokRes.status} ${tok.error_description || ""}`,
    };
  }

  const profile = await loginOAuthTokens(cfg, {
    provider: "openai",
    name: opts.name || "codex",
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token || null,
    expiresIn: tok.expires_in,
    meta: { clientId, tokenUrl, authUrl, kind: "codex_pkce" },
  });
  return { ok: true, ...profile, source: "openai-codex-oauth" };
}
