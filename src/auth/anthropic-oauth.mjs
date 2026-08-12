/**
 * Anthropic / Claude OAuth (PKCE) — Claude Code–compatible shape.
 *
 * Flow (same idea as Claude Code):
 *   1. Generate PKCE verifier/challenge + state
 *   2. Print authorize URL → user opens browser (already logged into claude.ai)
 *   3. User pastes authorization code (sometimes `code#state`)
 *   4. POST JSON token exchange → store access + refresh in auth profiles
 *
 * Defaults mirror Claude Code’s public client. Override via env if Anthropic
 * changes endpoints. Prefer ANTHROPIC_API_KEY for production API billing.
 *
 * Env:
 *   XCLAW_ANTHROPIC_OAUTH_CLIENT_ID
 *   XCLAW_ANTHROPIC_OAUTH_AUTHORIZE_URL
 *   XCLAW_ANTHROPIC_OAUTH_TOKEN_URL
 *   XCLAW_ANTHROPIC_OAUTH_REDIRECT_URI
 *   XCLAW_ANTHROPIC_OAUTH_SCOPE
 *   XCLAW_ANTHROPIC_OAUTH_MODE=max|console   (authorize host preset)
 */

import crypto from "node:crypto";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loginOAuthTokens, resolveProviderToken } from "./profiles.mjs";
import { canStartOAuth } from "./oauth-policy.mjs";

/** Claude Code public OAuth client id (widely documented). */
export const CLAUDE_CODE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

const DEFAULT_SCOPE = [
  "org:create_api_key",
  "user:profile",
  "user:inference",
  "user:sessions:claude_code",
  "user:mcp_servers",
  "user:file_upload",
].join(" ");

function base64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function pkcePair() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(
    crypto.createHash("sha256").update(verifier).digest()
  );
  return { verifier, challenge };
}

export function randomOAuthState() {
  return base64url(crypto.randomBytes(24));
}

function oauthConfig(opts = {}) {
  const mode = String(
    opts.mode || process.env.XCLAW_ANTHROPIC_OAUTH_MODE || "max"
  ).toLowerCase();

  // Endpoints extracted from Claude Code native binary (@anthropic-ai/claude-code-linux-x64)
  const authorizeUrl =
    opts.authorizeUrl ||
    process.env.XCLAW_ANTHROPIC_OAUTH_AUTHORIZE_URL ||
    (mode === "console"
      ? "https://console.anthropic.com/oauth/authorize"
      : mode === "platform"
        ? "https://platform.claude.com/oauth/authorize"
        : "https://claude.ai/oauth/authorize");

  const redirectUri =
    opts.redirectUri ||
    process.env.XCLAW_ANTHROPIC_OAUTH_REDIRECT_URI ||
    "https://platform.claude.com/oauth/code/callback";

  // Binary embeds platform.claude.com/v1/oauth/token (primary)
  const tokenUrl =
    opts.tokenUrl ||
    process.env.XCLAW_ANTHROPIC_OAUTH_TOKEN_URL ||
    "https://platform.claude.com/v1/oauth/token";

  const clientId =
    opts.clientId ||
    process.env.XCLAW_ANTHROPIC_OAUTH_CLIENT_ID ||
    CLAUDE_CODE_CLIENT_ID;

  const scope =
    opts.scope || process.env.XCLAW_ANTHROPIC_OAUTH_SCOPE || DEFAULT_SCOPE;

  return { mode, authorizeUrl, redirectUri, tokenUrl, clientId, scope };
}

/**
 * Build the browser authorize URL (do not exchange yet).
 */
export function buildAnthropicAuthorizeUrl(opts = {}) {
  const cfg = oauthConfig(opts);
  const { verifier, challenge } = opts.pkce || pkcePair();
  const state = opts.state || randomOAuthState();

  const url = new URL(cfg.authorizeUrl);
  url.searchParams.set("code", "true");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("scope", cfg.scope);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);

  return {
    url: url.toString(),
    verifier,
    challenge,
    state,
    redirectUri: cfg.redirectUri,
    clientId: cfg.clientId,
    tokenUrl: cfg.tokenUrl,
    scope: cfg.scope,
  };
}

/**
 * Parse pasted callback value: "CODE" or "CODE#STATE"
 */
export function parsePastedAuthCode(raw) {
  const s = String(raw || "").trim();
  if (!s) return { code: null, state: null };
  // Full redirect URL pasted by mistake
  try {
    if (s.startsWith("http://") || s.startsWith("https://")) {
      const u = new URL(s);
      return {
        code: u.searchParams.get("code"),
        state: u.searchParams.get("state"),
      };
    }
  } catch {
    /* not a URL */
  }
  if (s.includes("#")) {
    const [code, state] = s.split("#");
    return { code: code || null, state: state || null };
  }
  return { code: s, state: null };
}

/**
 * Exchange authorization code for tokens (JSON body, not form-urlencoded).
 */
export async function exchangeAnthropicAuthCode(opts = {}) {
  const {
    code,
    codeVerifier,
    state,
    redirectUri,
    clientId,
    tokenUrl,
  } = opts;

  if (!code || !codeVerifier) {
    return { ok: false, error: "code and codeVerifier required" };
  }

  const cfg = oauthConfig(opts);
  const endpoint = tokenUrl || cfg.tokenUrl;

  const body = {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri || cfg.redirectUri,
    client_id: clientId || cfg.clientId,
    code_verifier: codeVerifier,
  };
  if (state) body.state = state;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error:
        json?.error_description ||
        json?.error ||
        text.slice(0, 400) ||
        `token exchange HTTP ${res.status}`,
      raw: json,
    };
  }

  const accessToken = json.access_token;
  const refreshToken = json.refresh_token;
  const expiresIn = Number(json.expires_in || 3600);
  if (!accessToken) {
    return { ok: false, error: "no access_token in response", raw: json };
  }

  return {
    ok: true,
    accessToken,
    refreshToken: refreshToken || null,
    expiresAt: Date.now() + expiresIn * 1000,
    expiresIn,
    scope: json.scope || cfg.scope,
    account: json.account || null,
    organization: json.organization || null,
    raw: json,
  };
}

/**
 * Refresh access token.
 */
export async function refreshAnthropicOAuthToken(opts = {}) {
  const cfg = oauthConfig(opts);
  const refreshToken = opts.refreshToken;
  if (!refreshToken) return { ok: false, error: "refreshToken required" };

  const body = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: opts.clientId || cfg.clientId,
    scope: opts.scope || cfg.scope,
  };

  const res = await fetch(opts.tokenUrl || cfg.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error:
        json?.error_description ||
        json?.error ||
        text.slice(0, 400) ||
        `refresh HTTP ${res.status}`,
    };
  }

  return {
    ok: true,
    accessToken: json.access_token,
    refreshToken: json.refresh_token || refreshToken,
    expiresAt: Date.now() + Number(json.expires_in || 3600) * 1000,
    scope: json.scope,
    raw: json,
  };
}

/**
 * Interactive login: print URL → paste code → store profile.
 */
export async function loginAnthropicOAuth(cfg, opts = {}) {
  const gate = canStartOAuth("anthropic");
  if (!gate.ok) {
    return { ok: false, error: gate.reason, policy: gate.policy };
  }

  const built = buildAnthropicAuthorizeUrl(opts);
  const name = opts.name || "claude-oauth";

  console.log(`
XClaw · Claude / Anthropic OAuth (PKCE)
───────────────────────────────────────
1. Open this URL in a browser where you are already logged into Claude:

${built.url}

2. Approve access. Copy the authorization code shown
   (format may be CODE or CODE#STATE).

3. Paste it below.
`);

  let pasted = opts.code;
  if (!pasted) {
    const rl = readline.createInterface({ input, output });
    try {
      pasted = await rl.question("Authorization code: ");
    } finally {
      rl.close();
    }
  }

  const { code, state: pastedState } = parsePastedAuthCode(pasted);
  if (!code) {
    return { ok: false, error: "empty authorization code" };
  }

  const exchanged = await exchangeAnthropicAuthCode({
    ...built,
    code,
    codeVerifier: built.verifier,
    state: pastedState || built.state,
  });

  if (!exchanged.ok) {
    return exchanged;
  }

  const profile = await loginOAuthTokens(cfg, {
    provider: "anthropic",
    name,
    accessToken: exchanged.accessToken,
    refreshToken: exchanged.refreshToken,
    expiresAt: exchanged.expiresAt,
    meta: {
      scope: exchanged.scope,
      account: exchanged.account,
      organization: exchanged.organization,
      clientId: built.clientId,
      source: "anthropic-oauth-pkce",
    },
  });

  return {
    ok: true,
    provider: "anthropic",
    profileId: profile?.id || `anthropic:${name}`,
    expiresAt: exchanged.expiresAt,
    account: exchanged.account,
    message:
      "Claude OAuth tokens stored. Use model provider anthropic / claude-* with profile auth.",
  };
}

/**
 * Resolve a bearer token for Anthropic API calls (refresh if needed).
 */
export async function resolveAnthropicOAuthAccessToken(cfg, opts = {}) {
  // Prefer explicit env long-lived token (Claude Code CI style)
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return {
      ok: true,
      token: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      source: "CLAUDE_CODE_OAUTH_TOKEN",
    };
  }
  if (process.env.ANTHROPIC_AUTH_TOKEN) {
    return {
      ok: true,
      token: process.env.ANTHROPIC_AUTH_TOKEN,
      source: "ANTHROPIC_AUTH_TOKEN",
    };
  }

  // Profile resolve — reuse generic path when possible
  try {
    const resolved = await resolveProviderToken(cfg, "anthropic", opts);
    if (resolved?.token) {
      // Profile may include refresh via separate load — token is enough for Bearer
      return { ok: true, token: resolved.token, source: resolved.source || "profile" };
    }
  } catch {
    /* fall through */
  }

  return { ok: false, error: "no anthropic oauth token" };
}


/**
 * Import tokens Claude Code already stored on disk.
 * Shape (observed): { "claudeAiOauth": { accessToken, refreshToken, expiresAt, scopes } }
 * Paths: ~/.claude/.credentials.json  (and platform keychain — not read here)
 */
export async function importClaudeCodeCredentials(cfg, opts = {}) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");

  const candidates = [
    opts.path,
    process.env.CLAUDE_CREDENTIALS_PATH,
    path.join(os.homedir(), ".claude", ".credentials.json"),
    path.join(os.homedir(), ".claude", "credentials.json"),
  ].filter(Boolean);

  let raw = null;
  let used = null;
  for (const fp of candidates) {
    try {
      raw = JSON.parse(await fs.readFile(fp, "utf8"));
      used = fp;
      break;
    } catch {
      /* try next */
    }
  }
  if (!raw) {
    return {
      ok: false,
      error:
        "Claude Code credentials not found. Run `claude` login first, or path via CLAUDE_CREDENTIALS_PATH",
      tried: candidates,
    };
  }

  const block = raw.claudeAiOauth || raw.claude_ai_oauth || raw.oauth || null;
  if (!block?.accessToken && !block?.access_token) {
    return {
      ok: false,
      error: "credentials file has no claudeAiOauth.accessToken",
      path: used,
      keys: Object.keys(raw),
    };
  }

  const accessToken = block.accessToken || block.access_token;
  const refreshToken = block.refreshToken || block.refresh_token || null;
  let expiresAt = block.expiresAt || block.expires_at || null;
  if (typeof expiresAt === "number" && expiresAt < 1e12) {
    expiresAt = expiresAt * 1000; // seconds → ms
  }
  if (typeof expiresAt === "number") {
    expiresAt = new Date(expiresAt).toISOString();
  }

  const profile = await loginOAuthTokens(cfg, {
    provider: "anthropic",
    name: opts.name || "claude-code-import",
    accessToken,
    refreshToken,
    expiresAt,
    meta: {
      source: "claude-code-credentials",
      path: used,
      scopes: block.scopes || block.scope || null,
      subscriptionType: block.subscriptionType || null,
    },
  });

  return {
    ok: true,
    path: used,
    profileId: profile.profileId,
    expiresAt,
    message: "Imported Claude Code OAuth tokens into XClaw auth profiles",
  };
}

export {
  OAUTH_ATTESTATION,
  buildAnthropicOAuthHeaders,
  ensureOAuthSystemAttestation,
  isAnthropicOAuthToken,
} from "../providers/anthropic-oauth-headers.mjs";

export default {
  CLAUDE_CODE_CLIENT_ID,
  pkcePair,
  buildAnthropicAuthorizeUrl,
  parsePastedAuthCode,
  exchangeAnthropicAuthCode,
  refreshAnthropicOAuthToken,
  loginAnthropicOAuth,
  resolveAnthropicOAuthAccessToken,
  importClaudeCodeCredentials,
};
