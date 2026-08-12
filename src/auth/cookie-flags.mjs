/**
 * Cookie attribute parsing — HttpOnly, Secure, SameSite, Path, Domain, Max-Age, Expires.
 *
 * Browser note:
 *  - HttpOnly: not readable via document.cookie; still exportable from DevTools
 *  - Outbound Cookie request header only carries name=value pairs
 *  - Attributes apply when *setting* cookies (browser/CDP), not when sending
 */
export const COOKIE_ATTR_NAMES = new Set([
  "httponly",
  "secure",
  "samesite",
  "path",
  "domain",
  "max-age",
  "expires",
  "priority",
  "partitioned",
]);

/**
 * Parse a single Set-Cookie line or "name=value; Attr=..." segment list.
 * @returns {{ name, value, httpOnly, secure, sameSite, path, domain, maxAge, expires }}
 */
export function parseSetCookieLine(line) {
  const parts = String(line || "")
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) {
    throw new Error("empty cookie line");
  }
  const [nv, ...attrs] = parts;
  const eq = nv.indexOf("=");
  if (eq <= 0) throw new Error("cookie must be name=value");
  const name = nv.slice(0, eq).trim();
  const value = nv.slice(eq + 1).trim();
  if (!/^[!#$%&'*+\-.0-9A-Z^_`a-z|~]+$/.test(name)) {
    throw new Error(`invalid cookie name: ${name}`);
  }

  const out = {
    name,
    value,
    httpOnly: false,
    secure: false,
    sameSite: null,
    path: null,
    domain: null,
    maxAge: null,
    expires: null,
  };

  for (const a of attrs) {
    const lower = a.toLowerCase();
    if (lower === "httponly") {
      out.httpOnly = true;
      continue;
    }
    if (lower === "secure") {
      out.secure = true;
      continue;
    }
    if (lower === "partitioned") {
      out.partitioned = true;
      continue;
    }
    const i = a.indexOf("=");
    if (i < 0) continue;
    const k = a.slice(0, i).trim().toLowerCase();
    const v = a.slice(i + 1).trim();
    if (k === "samesite") {
      const ss = v.toLowerCase();
      if (["strict", "lax", "none"].includes(ss)) out.sameSite = ss;
    } else if (k === "path") out.path = v;
    else if (k === "domain") out.domain = v;
    else if (k === "max-age") {
      const n = Number(v);
      if (Number.isFinite(n)) out.maxAge = n;
    } else if (k === "expires") {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) out.expires = t;
    }
  }

  // SameSite=None requires Secure (browser rule)
  if (out.sameSite === "none") out.secure = true;

  return out;
}

/**
 * Parse Cookie request header "a=1; b=2" into list of {name,value}
 * (no attributes on request headers).
 */
export function parseCookieHeader(header) {
  if (!header) return [];
  return String(header)
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf("=");
      if (i <= 0) return null;
      return {
        name: p.slice(0, i).trim(),
        value: p.slice(i + 1).trim(),
        httpOnly: false,
        secure: false,
        sameSite: null,
        path: null,
        domain: null,
      };
    })
    .filter(Boolean);
}

/**
 * Parse mixed input: full Set-Cookie lines OR simple Cookie header.
 * Multi-line Set-Cookie supported.
 */
export function parseCookieInput(input) {
  const s = String(input || "").trim();
  if (!s) return [];

  // Multiple Set-Cookie style (newline separated)
  if (/httponly|samesite|secure/i.test(s) || s.includes("\n")) {
    const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const cookies = [];
    for (const line of lines) {
      // strip optional "Set-Cookie:" prefix
      const body = line.replace(/^set-cookie:\s*/i, "");
      try {
        cookies.push(parseSetCookieLine(body));
      } catch {
        /* skip bad line */
      }
    }
    if (cookies.length) return cookies;
  }

  return parseCookieHeader(s);
}

/**
 * Build Cookie request header from cookie objects (name=value only).
 */
export function toCookieHeader(cookies) {
  return (cookies || [])
    .filter((c) => c?.name)
    .map((c) => `${c.name}=${c.value ?? ""}`)
    .join("; ");
}

/**
 * CDP Network.setCookie / Playwright-style payload
 */
export function toBrowserCookieParams(cookie, defaults = {}) {
  const url = defaults.url || "https://grok.com";
  const param = {
    name: cookie.name,
    value: cookie.value ?? "",
    url: defaults.url,
    domain: cookie.domain || defaults.domain || undefined,
    path: cookie.path || defaults.path || "/",
    secure: cookie.secure === true || defaults.secure === true,
    httpOnly: cookie.httpOnly === true, // honor HttpOnly when injecting into browser
    sameSite:
      cookie.sameSite === "strict"
        ? "Strict"
        : cookie.sameSite === "lax"
          ? "Lax"
          : cookie.sameSite === "none"
            ? "None"
            : defaults.sameSite,
  };
  if (cookie.maxAge != null && cookie.maxAge >= 0) {
    param.expires = Math.floor(Date.now() / 1000) + cookie.maxAge;
  } else if (cookie.expires != null) {
    param.expires = Math.floor(cookie.expires / 1000);
  }
  // Prefer domain+path over url when domain set
  if (param.domain) delete param.url;
  return param;
}

/**
 * Summary for status (no values).
 */
export function cookieFlagsSummary(cookies) {
  return (cookies || []).map((c) => ({
    name: c.name,
    httpOnly: Boolean(c.httpOnly),
    secure: Boolean(c.secure),
    sameSite: c.sameSite,
    path: c.path,
    domain: c.domain,
  }));
}

/**
 * Ensure session cookies intended for HTTPS APIs are marked Secure when
 * domain is x.ai / grok.com (policy helper).
 */
export function enforceSecureForXaiHosts(cookie) {
  const d = (cookie.domain || "").toLowerCase();
  const hostSensitive =
    d.includes("x.ai") ||
    d.includes("grok.com") ||
    !cookie.domain; // default host-only for grok
  if (hostSensitive) {
    return { ...cookie, secure: true };
  }
  return cookie;
}
