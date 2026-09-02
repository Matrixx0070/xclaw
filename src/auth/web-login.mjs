/**
 * Mode 3 — Grok Web login with secure cookie handling.
 *
 * Security:
 *  - File mode 0600, directory 0700
 *  - Atomic write (tmp + rename)
 *  - Optional encryption at rest (XCLAW_SESSION_SECRET or derived)
 *  - Input size limits; cookie name allow-hints; no secrets in logs
 *  - Redacted status; secure delete on logout
 *  - Optional maxAge; expired sessions rejected
 *
 * `paths()` honours `cfg.auth?.web?.sessionPath` then `paths.configDir`
 * then `XCLAW_CONFIG_DIR` then null. No home fallback. Do not honour
 * `XCLAW_STATE_DIR`. A cfg without configDir is never a real caller
 * (`loadConfig()` stamps it unconditionally). `importWebSession` still
 * returns without persisting (do not `mkdir(null)`). `loadWebSession`
 * returns null. `clearWebSession` no-ops. Keep `os` for
 * `getSessionSecret` (`os.hostname` / `os.userInfo`).
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const MAX_COOKIE_BYTES = 16 * 1024; // 16 KiB
const MAX_AUTH_BYTES = 8 * 1024;
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function paths(cfg = {}) {
  const explicit = cfg.auth?.web?.sessionPath;
  const configDir = cfg.paths?.configDir || process.env.XCLAW_CONFIG_DIR || null;
  if (explicit) return { configDir, webSessionPath: explicit };
  return {
    configDir,
    webSessionPath: configDir ? path.join(configDir, "web-session.json") : null,
  };
}

/** Never print full cookie / token */
export function redactSecret(s, keep = 4) {
  if (s == null || s === "") return null;
  const str = String(s);
  if (str.length <= keep * 2) return "***";
  return `${str.slice(0, keep)}…${str.slice(-keep)} (len=${str.length})`;
}

export function redactSession(session) {
  if (!session) return null;
  return {
    mode: session.mode,
    provider: session.provider,
    source: session.source,
    imported_at: session.imported_at,
    expires_at: session.expires_at,
    hasCookie: Boolean(session.cookie),
    hasAuthorization: Boolean(session.authorization),
    cookie: session.cookie ? redactSecret(session.cookie) : null,
    authorization: session.authorization
      ? redactSecret(session.authorization)
      : null,
  };
}

/**
 * Normalize Cookie header: trim, drop empty pairs, reject abuse.
 */
export function sanitizeCookieHeader(input) {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;
  if (Buffer.byteLength(s, "utf8") > MAX_COOKIE_BYTES) {
    throw new Error(`cookie exceeds ${MAX_COOKIE_BYTES} bytes`);
  }
  // Strip CR/LF (header injection)
  if (/[\r\n]/.test(s)) {
    throw new Error("cookie must not contain CR/LF");
  }
  // Collapse accidental wrapping
  s = s.replace(/\s+/g, " ").trim();
  // Basic pair structure name=value; name2=value2
  const parts = s.split(";").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  for (const p of parts) {
    if (!p.includes("=")) {
      throw new Error(`invalid cookie pair (no =): ${p.slice(0, 20)}`);
    }
    const name = p.split("=")[0].trim();
    if (!/^[!#$%&'*+\-.0-9A-Z^_`a-z|~]+$/.test(name)) {
      throw new Error(`invalid cookie name: ${name.slice(0, 40)}`);
    }
  }
  return parts.join("; ");
}

export function sanitizeAuthorization(input) {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;
  if (/[\r\n]/.test(s)) throw new Error("authorization must not contain CR/LF");
  if (Buffer.byteLength(s, "utf8") > MAX_AUTH_BYTES) {
    throw new Error(`authorization exceeds ${MAX_AUTH_BYTES} bytes`);
  }
  if (!/^Bearer\s+\S+/i.test(s) && !/^\S+$/.test(s)) {
    throw new Error("authorization must be Bearer token or raw token");
  }
  if (!/^Bearer\s+/i.test(s)) s = `Bearer ${s}`;
  return s;
}

function getSessionSecret(cfg = {}) {
  const fromEnv =
    process.env.XCLAW_SESSION_SECRET ||
    process.env.XCLAW_COOKIE_SECRET ||
    cfg.auth?.web?.sessionSecret;
  if (fromEnv && String(fromEnv).length >= 16) {
    return crypto.createHash("sha256").update(String(fromEnv)).digest();
  }
  // Machine-local derived key (best-effort, not as strong as user secret)
  const material = [
    os.hostname(),
    os.userInfo().username,
    "xclaw-web-session-v1",
  ].join("|");
  return crypto.createHash("sha256").update(material).digest();
}

function encryptPayload(plainObj, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(plainObj), "utf8");
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: enc.toString("base64"),
  };
}

function decryptPayload(wrapped, key) {
  if (!wrapped?.data || !wrapped?.iv || !wrapped?.tag) {
    throw new Error("invalid encrypted session envelope");
  }
  const iv = Buffer.from(wrapped.iv, "base64");
  const tag = Buffer.from(wrapped.tag, "base64");
  const data = Buffer.from(wrapped.data, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(dec.toString("utf8"));
}

async function atomicWriteSecure(filePath, body) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    await fs.chmod(dir, 0o700);
  } catch {
    /* */
  }
  const tmp = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, body, { mode: 0o600 });
  try {
    await fs.chmod(tmp, 0o600);
  } catch {
    /* */
  }
  await fs.rename(tmp, filePath);
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    /* */
  }
}

/** Overwrite then unlink */
export async function secureUnlink(filePath) {
  try {
    const st = await fs.stat(filePath);
    const zeros = Buffer.alloc(Math.min(st.size, 1024 * 1024), 0);
    await fs.writeFile(filePath, zeros);
  } catch {
    /* */
  }
  try {
    await fs.unlink(filePath);
  } catch {
    /* */
  }
}

export function webLoginInstructions(cfg = {}) {
  const accounts = cfg.auth?.xai?.accountsHost || "https://accounts.x.ai";
  const grok = cfg.auth?.web?.loginUrl || "https://grok.com";
  return {
    ok: true,
    method: "web",
    steps: [
      `1. Open ${grok} or ${accounts} in your browser`,
      "2. Sign in with your Grok account (free or paid subscription)",
      "3. Import session (never paste cookies into chat logs):",
      '     xclaw auth web-import --cookie "$COOKIE"',
      "     xclaw auth web-import --file ./session.json",
      "4. Optional: export XCLAW_SESSION_SECRET=... for stronger encryption at rest",
      "5. xclaw auth status",
    ],
    loginUrls: [grok, accounts],
    security: [
      "Session file mode 0600, encrypted at rest when possible",
      "Do not commit web-session.json to git",
      "xclaw auth logout securely wipes the file",
    ],
  };
}

/**
 * Import web session from cookie string and/or bearer token.
 * Supports Set-Cookie lines with HttpOnly / Secure / SameSite.
 */
export async function importWebSession(cfg = {}, input = {}) {
  const p = paths(cfg);
  if (!p.webSessionPath) {
    return { ok: false, error: "no web session path" };
  }
  let cookie;
  let authorization;
  let cookieObjects = [];
  try {
    const {
      parseCookieInput,
      toCookieHeader,
      enforceSecureForXaiHosts,
      cookieFlagsSummary,
    } = await import("./cookie-flags.mjs");

    const rawCookie = input.cookie || input.Cookie || null;
    if (rawCookie) {
      cookieObjects = parseCookieInput(rawCookie).map(enforceSecureForXaiHosts);
      cookie = sanitizeCookieHeader(toCookieHeader(cookieObjects));
    }
    authorization = sanitizeAuthorization(
      input.authorization ||
        input.Authorization ||
        (input.token ? `Bearer ${input.token}` : null)
    );
  } catch (e) {
    return { ok: false, code: "INVALID_INPUT", error: e.message };
  }

  if (!cookie && !authorization && !input.raw) {
    return {
      ok: false,
      error: "Provide --cookie, --token, or --file with session fields",
    };
  }

  const maxAge =
    Number(cfg.auth?.web?.maxAgeMs) > 0
      ? Number(cfg.auth.web.maxAgeMs)
      : DEFAULT_MAX_AGE_MS;

  const { cookieFlagsSummary } = await import("./cookie-flags.mjs");
  const secrets = {
    cookie: cookie || null,
    authorization: authorization || null,
    raw: input.raw ? String(input.raw).slice(0, MAX_COOKIE_BYTES) : null,
    cookies: cookieObjects,
    flags: cookieFlagsSummary(cookieObjects),
  };

  const meta = {
    provider: "xai",
    mode: "web",
    imported_at: Date.now(),
    expires_at: Date.now() + maxAge,
    login_hint: "grok.com / accounts.x.ai",
    encrypted: true,
  };

  const key = getSessionSecret(cfg);
  const envelope = {
    ...meta,
    secrets: encryptPayload(secrets, key),
  };

  try {
    await atomicWriteSecure(
      p.webSessionPath,
      JSON.stringify(envelope, null, 2) + "\n"
    );
  } catch (e) {
    return { ok: false, error: e.message };
  }

  return {
    ok: true,
    method: "web",
    path: p.webSessionPath,
    hasCookie: Boolean(secrets.cookie),
    hasAuthorization: Boolean(secrets.authorization),
    expires_at: meta.expires_at,
    encrypted: true,
    // never echo secrets
  };
}

export async function importWebSessionFile(cfg, filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return importWebSession(cfg, { cookie: raw.trim() });
  }
  return importWebSession(cfg, data);
}

export async function loadWebSession(cfg = {}) {
  const p = paths(cfg);
  if (!p.webSessionPath) return null;
  try {
    const raw = await fs.readFile(p.webSessionPath, "utf8");
    const data = JSON.parse(raw);
    let secrets = {
      cookie: data.cookie || null,
      authorization: data.authorization || null,
      raw: data.raw || null,
    };
    // Encrypted envelope (v1)
    if (data.secrets?.data) {
      try {
        secrets = decryptPayload(data.secrets, getSessionSecret(cfg));
      } catch {
        return null; // wrong secret or tampered
      }
    }
    if (!secrets.cookie && !secrets.authorization) return null;
    if (data.expires_at && Date.now() > data.expires_at) {
      await secureUnlink(p.webSessionPath);
      return null;
    }
    return {
      mode: "web",
      provider: data.provider || "xai",
      source: "web",
      cookie: secrets.cookie,
      authorization: secrets.authorization,
      raw: secrets.raw,
      cookies: secrets.cookies || [],
      flags: secrets.flags || [],
      imported_at: data.imported_at,
      expires_at: data.expires_at,
    };
  } catch {
    return null;
  }
}

export async function clearWebSession(cfg = {}) {
  const p = paths(cfg);
  if (!p.webSessionPath) return { ok: true };
  await secureUnlink(p.webSessionPath);
  return { ok: true };
}

/**
 * Headers for web-mode requests. Does not log.
 * Cookie header is name=value only (HttpOnly is a storage flag, not sent).
 */
export function webSessionHeaders(session) {
  if (!session) return {};
  const h = {
    "User-Agent":
      session.userAgent ||
      "Mozilla/5.0 (compatible; XClaw/3.11; Grok Web session)",
  };
  if (session.cookie) h.Cookie = session.cookie;
  if (session.authorization) h.Authorization = session.authorization;
  return h;
}

/**
 * Browser/CDP cookie injection params — preserves HttpOnly / Secure / SameSite.
 */
export async function webSessionBrowserCookies(session, defaults = {}) {
  const { toBrowserCookieParams } = await import("./cookie-flags.mjs");
  const list =
    session?.cookies?.length > 0
      ? session.cookies
      : session?.cookie
        ? (await import("./cookie-flags.mjs")).parseCookieHeader(session.cookie)
        : [];
  return list.map((c) =>
    toBrowserCookieParams(
      { ...c, httpOnly: c.httpOnly !== false }, // default HttpOnly true for injected session cookies
      {
        url: defaults.url || "https://grok.com",
        domain: defaults.domain,
        path: defaults.path || "/",
        secure: true,
      }
    )
  );
}

/**
 * Safe status blob for CLI (redacted).
 */
export async function webSessionStatus(cfg = {}) {
  const s = await loadWebSession(cfg);
  if (!s) return { present: false };
  return { present: true, ...redactSession(s) };
}
