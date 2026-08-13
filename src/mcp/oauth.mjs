/**
 * OAuth 2.1 for remote MCP servers (MCP auth spec, 2025-06-18).
 *
 * Flow: 401 → protected-resource metadata (RFC 9728) → authorization-server
 * metadata (RFC 8414) → dynamic client registration (RFC 7591, public client
 * + PKCE) → authorize (S256, `resource` per RFC 8707) → code exchange →
 * per-server token store with refresh.
 *
 * Reuses the PKCE primitives from the provider OAuth engine — same machinery
 * that runs the Anthropic/xAI logins.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pkcePair, randomOAuthState } from "../auth/anthropic-oauth.mjs";

const STORE_FILE = "mcp-oauth.json";

function storePath(cfg = {}) {
  const dir = cfg.paths?.configDir || path.join(os.homedir(), ".xclaw");
  return path.join(dir, STORE_FILE);
}

export function loadMcpOAuthStore(cfg = {}) {
  try {
    return JSON.parse(fs.readFileSync(storePath(cfg), "utf8"));
  } catch {
    return {};
  }
}

export function saveMcpOAuthStore(cfg, store) {
  const p = storePath(cfg);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(store, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(p, 0o600);
  } catch {}
}

async function fetchJson(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    signal: AbortSignal.timeout(opts.timeoutMs || 15_000),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(
      body.error_description || body.error || `${url} → HTTP ${r.status}`
    );
  }
  return body;
}

/**
 * Discover the authorization server for an MCP endpoint.
 * Tries the WWW-Authenticate resource_metadata pointer first (from a 401),
 * then the well-known locations relative to the server URL.
 */
export async function discoverMcpAuth(serverUrl, opts = {}) {
  const u = new URL(serverUrl);
  const origin = u.origin;
  const candidates = [];
  if (opts.resourceMetadataUrl) candidates.push(opts.resourceMetadataUrl);
  // RFC 9728 path-aware then root
  const p = u.pathname.replace(/\/$/, "");
  if (p && p !== "/") {
    candidates.push(`${origin}/.well-known/oauth-protected-resource${p}`);
  }
  candidates.push(`${origin}/.well-known/oauth-protected-resource`);

  let resource = null;
  for (const c of candidates) {
    try {
      resource = await fetchJson(c);
      if (resource?.authorization_servers?.length) break;
    } catch {
      resource = null;
    }
  }

  const asIssuers = resource?.authorization_servers?.length
    ? resource.authorization_servers
    : [origin]; // fallback: server is its own AS (common for simple remotes)

  let as = null;
  let issuer = null;
  for (const cand of asIssuers) {
    const iu = new URL(cand);
    const ip = iu.pathname.replace(/\/$/, "");
    const metaCandidates = [
      `${iu.origin}/.well-known/oauth-authorization-server${ip}`,
      `${iu.origin}/.well-known/oauth-authorization-server`,
      `${iu.origin}/.well-known/openid-configuration`,
    ];
    for (const mc of metaCandidates) {
      try {
        const meta = await fetchJson(mc);
        if (meta?.authorization_endpoint && meta?.token_endpoint) {
          as = meta;
          issuer = cand;
          break;
        }
      } catch {
        /* next candidate */
      }
    }
    if (as) break;
  }
  if (!as) {
    throw new Error(
      `No authorization server metadata found for ${serverUrl} — the server may not require OAuth or uses a static key`
    );
  }
  return {
    resource: resource?.resource || serverUrl,
    scopes: resource?.scopes_supported || null,
    issuer,
    authorizationEndpoint: as.authorization_endpoint,
    tokenEndpoint: as.token_endpoint,
    registrationEndpoint: as.registration_endpoint || null,
  };
}

/** RFC 7591 dynamic registration (public client + PKCE). */
export async function registerMcpClient(discovery, { redirectUri, clientName } = {}) {
  if (!discovery.registrationEndpoint) {
    throw new Error(
      "Authorization server does not support dynamic client registration — configure clientId manually on the server entry"
    );
  }
  const reg = await fetchJson(discovery.registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: clientName || "XClaw",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!reg.client_id) throw new Error("registration returned no client_id");
  return { clientId: reg.client_id, clientSecret: reg.client_secret || null };
}

/** Build the authorize URL (PKCE S256 + RFC 8707 resource binding). */
export function buildMcpAuthorizeUrl(discovery, { clientId, redirectUri, scopes } = {}) {
  const { verifier, challenge } = pkcePair();
  const state = randomOAuthState();
  const url = new URL(discovery.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", discovery.resource);
  const scope = (scopes || discovery.scopes || []).join(" ");
  if (scope) url.searchParams.set("scope", scope);
  return { authorizeUrl: url.toString(), verifier, state };
}

async function tokenRequest(tokenEndpoint, params) {
  const r = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || `token → HTTP ${r.status}`);
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || null,
    expiresAt: body.expires_in ? Date.now() + Number(body.expires_in) * 1000 : null,
    scope: body.scope || null,
    tokenType: body.token_type || "Bearer",
  };
}

export function exchangeMcpAuthCode(discovery, { clientId, redirectUri, code, verifier }) {
  return tokenRequest(discovery.tokenEndpoint, {
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource: discovery.resource,
  });
}

export function refreshMcpToken(discovery, { clientId, refreshToken }) {
  return tokenRequest(discovery.tokenEndpoint, {
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: refreshToken,
    resource: discovery.resource,
  });
}

/**
 * Resolve a live access token for a server (refreshing when within 60s of
 * expiry). Returns null when the server has no stored OAuth grant.
 */
export async function resolveMcpAccessToken(cfg, serverName) {
  const store = loadMcpOAuthStore(cfg);
  const entry = store[serverName];
  if (!entry?.tokens?.accessToken) return null;
  const { tokens, discovery, clientId } = entry;
  const fresh = !tokens.expiresAt || tokens.expiresAt - Date.now() > 60_000;
  if (fresh) return tokens.accessToken;
  if (!tokens.refreshToken) return tokens.accessToken; // hope it still works
  const next = await refreshMcpToken(discovery, {
    clientId,
    refreshToken: tokens.refreshToken,
  });
  entry.tokens = { ...next, refreshToken: next.refreshToken || tokens.refreshToken };
  store[serverName] = entry;
  saveMcpOAuthStore(cfg, store);
  return entry.tokens.accessToken;
}

export function storeMcpGrant(cfg, serverName, { discovery, clientId, tokens }) {
  const store = loadMcpOAuthStore(cfg);
  store[serverName] = {
    discovery,
    clientId,
    tokens,
    updatedAt: new Date().toISOString(),
  };
  saveMcpOAuthStore(cfg, store);
}

export function dropMcpGrant(cfg, serverName) {
  const store = loadMcpOAuthStore(cfg);
  delete store[serverName];
  saveMcpOAuthStore(cfg, store);
}
