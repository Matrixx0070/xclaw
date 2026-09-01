/**
 * Option B — Sign in with Grok / xAI account (OAuth).
 *
 * Flows supported:
 *  1) Device-code (CLI-friendly) against configurable auth host
 *  2) Import session from official Grok CLI (~/.grok/auth.json)
 *  3) Fallback: XAI_API_KEY / XCLAW_API_KEY
 *
 * Note: xAI OAuth client_id / exact device endpoints may require
 * registration with xAI. Defaults target accounts.x.ai / auth.x.ai
 * patterns used by Grok CLI; override via config.auth.xai.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { createServer } from "node:http";

const DEFAULTS = {
  authHost: "https://auth.x.ai",
  accountsHost: "https://accounts.x.ai",
  apiHost: "https://api.x.ai",
  /** Public/native client id — replace with registered XClaw app id when issued */
  clientId: process.env.XCLAW_XAI_CLIENT_ID || "xclaw-cli",
  scope: "openid profile offline_access",
  tokenPath: null, // set at runtime → ~/.xclaw/auth.json
};

function authPaths(cfg = {}) {
  const configDir =
    cfg.paths?.configDir ||
    process.env.XCLAW_CONFIG_DIR ||
    path.join(os.homedir(), ".xclaw");
  return {
    configDir,
    tokenPath:
      cfg.auth?.xai?.tokenPath ||
      path.join(configDir, "auth.json"),
    grokCliAuth: path.join(os.homedir(), ".grok", "auth.json"),
  };
}

function xaiCfg(cfg = {}) {
  return { ...DEFAULTS, ...(cfg.auth?.xai || {}) };
}

async function readJsonSafe(p) {
  try {
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeTokens(tokenPath, data) {
  await fs.mkdir(path.dirname(tokenPath), { recursive: true });
  await fs.writeFile(tokenPath, JSON.stringify(data, null, 2) + "\n", {
    mode: 0o600,
  });
  try {
    await fs.chmod(tokenPath, 0o600);
  } catch {
    /* windows */
  }
}

/**
 * Re-read after unbounded refresh fetch. logoutXai (CLI `xclaw auth logout`)
 * unlinks the same auth.json. Save of the stale snapshot must not resurrect
 * a revoked vault.
 *
 * missing held → null
 * missing onDisk + prior existed → null (logout won; do not resurrect)
 * missing onDisk + no prior → held (first write; RULE(m) pin has no file yet)
 * onDisk refresh_token differs from prior → null (concurrent login/other refresh)
 * else return held
 */
export function settleAfterXaiRefresh(held, onDisk, prior) {
  if (!held) return null;
  if (!onDisk) {
    if (prior) return null;
    return held;
  }
  if (
    prior?.refresh_token &&
    onDisk.refresh_token &&
    onDisk.refresh_token !== prior.refresh_token
  ) {
    return null;
  }
  return held;
}

/**
 * Load auth — three Grok modes (priority):
 *  1) api key
 *  2) oauth (xclaw tokens / grok CLI)
 *  3) web session (grok.com login import)
 *
 * Prefer cfg.auth.mode to force one path: "api" | "oauth" | "web"
 */
export async function loadXaiAuth(cfg = {}) {
  const prefer = cfg.auth?.mode || process.env.XCLAW_AUTH_MODE || "auto";
  const paths = authPaths(cfg);

  const loadApi = () => {
    const key =
      process.env.XCLAW_API_KEY ||
      process.env.XAI_API_KEY ||
      cfg.agent?.apiKey ||
      cfg.auth?.apiKey;
    if (!key) return null;
    return {
      access_token: key,
      token_type: "Bearer",
      source: "api_key",
      mode: "api",
      isApiKey: true,
    };
  };

  const loadOauth = async () => {
    const own = await readJsonSafe(paths.tokenPath);
    if (own?.access_token && !isExpired(own)) {
      return { ...own, source: "xclaw", mode: "oauth" };
    }
    if (own?.refresh_token) {
      const refreshed = await refreshXaiToken(own, cfg).catch(() => null);
      if (refreshed?.access_token) {
        return { ...refreshed, source: "xclaw-refresh", mode: "oauth" };
      }
    }
    const grok = await readJsonSafe(paths.grokCliAuth);
    if (grok?.access_token && !isExpired(grok)) {
      return { ...grok, source: "grok-cli", mode: "oauth" };
    }
    return null;
  };

  const loadWeb = async () => {
    try {
      const { loadWebSession } = await import("./web-login.mjs");
      const web = await loadWebSession(cfg);
      if (!web) return null;
      return {
        ...web,
        access_token: web.authorization?.replace(/^Bearer\s+/i, "") || null,
        mode: "web",
        source: "web",
        isWebSession: true,
      };
    } catch {
      return null;
    }
  };

  if (prefer === "api") return loadApi();
  if (prefer === "oauth") return loadOauth();
  if (prefer === "web") return loadWeb();

  // auto: api → oauth → web
  return (await loadApi()) || (await loadOauth()) || (await loadWeb()) || null;
}

function isExpired(tok, skewMs = 60_000) {
  if (!tok?.expires_at && !tok?.expires_in) return false;
  const exp =
    tok.expires_at ||
    (tok.obtained_at ? tok.obtained_at + tok.expires_in * 1000 : 0);
  if (!exp) return false;
  return Date.now() >= exp - skewMs;
}

/**
 * Authorization header value for API calls
 */
export async function getXaiAuthorization(cfg = {}) {
  const auth = await loadXaiAuth(cfg);
  if (!auth?.access_token) return null;
  return `Bearer ${auth.access_token}`;
}

/**
 * Refresh using refresh_token (standard OAuth).
 */
export async function refreshXaiToken(tok, cfg = {}) {
  const c = xaiCfg(cfg);
  const paths = authPaths(cfg);
  if (!tok?.refresh_token) {
    throw new Error("no refresh_token");
  }
  const prior = await readJsonSafe(paths.tokenPath);
  const url = `${c.authHost.replace(/\/$/, "")}/oauth/token`;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tok.refresh_token,
    client_id: c.clientId,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`refresh failed ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const next = normalizeTokenResponse(data, tok);
  const onDisk = await readJsonSafe(paths.tokenPath);
  const settled = settleAfterXaiRefresh(next, onDisk, prior);
  if (!settled) return null;
  await writeTokens(paths.tokenPath, settled);
  return next;
}

function normalizeTokenResponse(data, prev = {}) {
  const now = Date.now();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || prev.refresh_token || null,
    token_type: data.token_type || "Bearer",
    expires_in: data.expires_in || null,
    obtained_at: now,
    expires_at: data.expires_in ? now + data.expires_in * 1000 : null,
    scope: data.scope || prev.scope,
    provider: "xai",
  };
}

/**
 * Device-code login (best for CLI / remote).
 * Prints URL + user_code; polls until approved.
 */
export async function loginDeviceCode(cfg = {}, opts = {}) {
  const c = xaiCfg(cfg);
  const paths = authPaths(cfg);
  const deviceUrl = `${c.authHost.replace(/\/$/, "")}/oauth/device/code`;
  const tokenUrl = `${c.authHost.replace(/\/$/, "")}/oauth/token`;

  const startRes = await fetch(deviceUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.clientId,
      scope: c.scope,
    }),
  });

  if (!startRes.ok) {
    const t = await startRes.text().catch(() => "");
    return {
      ok: false,
      code: "DEVICE_START_FAILED",
      error: `Device code start failed (${startRes.status}). ${t.slice(0, 180)}`,
      hint:
        "Register an OAuth app with xAI or set auth.xai.clientId. Meanwhile use API key or: grok login && xclaw auth import-grok",
    };
  }

  const dc = await startRes.json();
  const verificationUri =
    dc.verification_uri_complete ||
    dc.verification_uri ||
    `${c.accountsHost}/device`;
  const interval = (dc.interval || 5) * 1000;
  const expires = Date.now() + (dc.expires_in || 600) * 1000;

  opts.onCode?.({
    user_code: dc.user_code,
    verification_uri: verificationUri,
    expires_in: dc.expires_in,
  });

  while (Date.now() < expires) {
    await sleep(interval);
    const poll = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: dc.device_code,
        client_id: c.clientId,
      }),
    });
    const data = await poll.json().catch(() => ({}));
    if (poll.ok && data.access_token) {
      const tok = normalizeTokenResponse(data);
      await writeTokens(paths.tokenPath, tok);
      return { ok: true, method: "device_code", path: paths.tokenPath };
    }
    if (data.error === "authorization_pending" || data.error === "slow_down") {
      continue;
    }
    if (data.error === "expired_token") break;
    if (data.error) {
      return { ok: false, code: data.error, error: data.error_description || data.error };
    }
  }
  return { ok: false, code: "TIMEOUT", error: "Device login timed out" };
}

/**
 * Loopback PKCE browser login (local desktop).
 */
export async function loginPkceLoopback(cfg = {}, opts = {}) {
  const c = xaiCfg(cfg);
  const paths = authPaths(cfg);
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));

  const { port, waitForCode } = await listenForCallback(state);
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const authUrl =
    `${c.authHost.replace(/\/$/, "")}/oauth/authorize?` +
    new URLSearchParams({
      response_type: "code",
      client_id: c.clientId,
      redirect_uri: redirectUri,
      scope: c.scope,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();

  opts.onUrl?.(authUrl);

  const code = await waitForCode;
  const tokenUrl = `${c.authHost.replace(/\/$/, "")}/oauth/token`;
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: c.clientId,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return {
      ok: false,
      code: "TOKEN_EXCHANGE_FAILED",
      error: t.slice(0, 200),
      authUrl,
    };
  }
  const data = await res.json();
  const tok = normalizeTokenResponse(data);
  await writeTokens(paths.tokenPath, tok);
  return { ok: true, method: "pkce", path: paths.tokenPath };
}

function listenForCallback(expectedState) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        const u = new URL(req.url || "/", "http://127.0.0.1");
        if (u.pathname !== "/callback") {
          res.writeHead(404);
          res.end();
          return;
        }
        const code = u.searchParams.get("code");
        const state = u.searchParams.get("state");
        if (state !== expectedState || !code) {
          res.writeHead(400);
          res.end("Invalid state or missing code");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<html><body><h3>XClaw signed in</h3><p>You can close this window.</p></body></html>"
        );
        server.close();
        resolveCode(code);
      } catch (e) {
        reject(e);
      }
    });
    let resolveCode;
    const waitForCode = new Promise((r) => {
      resolveCode = r;
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ port, waitForCode });
    });
    server.on("error", reject);
  });
}

/**
 * Import tokens from official Grok CLI auth file
 */
export async function importGrokCliAuth(cfg = {}) {
  const paths = authPaths(cfg);
  const grok = await readJsonSafe(paths.grokCliAuth);
  if (!grok?.access_token) {
    return {
      ok: false,
      error: "No ~/.grok/auth.json — run: grok login",
    };
  }
  const tok = {
    ...grok,
    provider: "xai",
    imported_from: "grok-cli",
    obtained_at: grok.obtained_at || Date.now(),
  };
  await writeTokens(paths.tokenPath, tok);
  return { ok: true, path: paths.tokenPath, source: "grok-cli" };
}

export async function logoutXai(cfg = {}) {
  const paths = authPaths(cfg);
  try {
    await fs.unlink(paths.tokenPath);
  } catch {
    /* */
  }
  return { ok: true };
}

export async function authStatus(cfg = {}) {
  const auth = await loadXaiAuth(cfg);
  if (!auth) {
    return {
      loggedIn: false,
      method: null,
      freePath: "local",
      hint:
        "No cloud auth. XClaw can run fully free with local Ollama — see docs/AUTH_FREE_GROK.md",
    };
  }
  return {
    loggedIn: true,
    method: auth.isApiKey ? "api_key" : auth.source || "oauth",
    expires_at: auth.expires_at || null,
    has_refresh: Boolean(auth.refresh_token),
    freePath: auth.isApiKey ? "api_key_or_credits" : "oauth_or_subscription",
  };
}

/**
 * Resolve brain backend for free-friendly installs.
 * Prefer cloud auth when present; otherwise ollama.
 */
export async function resolveBrainAuth(cfg = {}) {
  const auth = await loadXaiAuth(cfg);
  if (auth?.access_token) {
    return {
      mode: auth.isApiKey ? "xai_api_key" : "xai_oauth",
      authorization: `Bearer ${auth.access_token}`,
      apiHost: xaiCfg(cfg).apiHost,
    };
  }
  const ollamaUrl =
    cfg.voice?.ollamaUrl ||
    cfg.agent?.ollamaUrl ||
    process.env.XCLAW_OLLAMA_URL ||
    "http://127.0.0.1:11434";
  const model =
    cfg.agent?.model ||
    cfg.voice?.ollamaModel ||
    process.env.XCLAW_OLLAMA_MODEL ||
    "qwen2.5:7b";
  return {
    mode: "local_ollama",
    ollamaUrl,
    model,
    hint: "Free path — no Grok paid account required",
  };
}

function base64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * High-level login entry
 * @param {'device'|'pkce'|'import-grok'|'auto'} method
 */
export async function loginXai(cfg = {}, method = "auto", opts = {}) {
  if (method === "import-grok") return importGrokCliAuth(cfg);
  if (method === "pkce") return loginPkceLoopback(cfg, opts);
  if (method === "device") return loginDeviceCode(cfg, opts);

  // auto: try import grok cli → device → pkce
  const imported = await importGrokCliAuth(cfg);
  if (imported.ok) return { ...imported, method: "import-grok" };

  const device = await loginDeviceCode(cfg, opts);
  if (device.ok) return device;
  // if device endpoint missing, surface clear next steps
  if (device.code === "DEVICE_START_FAILED") {
    return {
      ...device,
      fallback: [
        "xclaw auth login --method import-grok   # after: grok login",
        "export XAI_API_KEY=xai-...             # from https://console.x.ai",
        "xclaw auth login --method pkce          # browser loopback when client id registered",
      ],
    };
  }
  return device;
}
