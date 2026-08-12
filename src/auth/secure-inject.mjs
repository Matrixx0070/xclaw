/**
 * Secure cookie injection into browser contexts (CDP / Playwright-style).
 *
 * Rules:
 *  - HTTPS-only targets for xAI/Grok hosts
 *  - HttpOnly + Secure forced for session cookies
 *  - Domain allowlist (no open redirect to arbitrary hosts)
 *  - No logging of cookie values
 *  - Optional partition / ephemeral context
 *  - Idempotent set; clear before inject when requested
 */
import {
  parseCookieInput,
  toBrowserCookieParams,
  enforceSecureForXaiHosts,
  cookieFlagsSummary,
} from "./cookie-flags.mjs";
import { loadWebSession, redactSecret } from "./web-login.mjs";

/** Default hosts allowed for Grok web session injection */
export const DEFAULT_COOKIE_HOST_ALLOWLIST = [
  "grok.com",
  ".grok.com",
  "x.ai",
  ".x.ai",
  "accounts.x.ai",
  ".accounts.x.ai",
  "auth.x.ai",
  ".auth.x.ai",
];

export function isHostAllowed(hostOrDomain, allowlist = DEFAULT_COOKIE_HOST_ALLOWLIST) {
  if (!hostOrDomain) return false;
  const h = String(hostOrDomain).toLowerCase().replace(/^\./, "");
  return allowlist.some((a) => {
    const x = a.toLowerCase().replace(/^\./, "");
    return h === x || h.endsWith("." + x);
  });
}

export function assertHttpsUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`invalid url: ${url}`);
  }
  if (u.protocol !== "https:") {
    throw new Error(`cookie injection requires https (got ${u.protocol})`);
  }
  return u;
}

/**
 * Build a hardened list of browser cookie params from a session or raw cookie string.
 */
export function buildSecureInjectPlan(opts = {}) {
  const {
    session = null,
    cookieHeader = null,
    url = "https://grok.com",
    allowlist = DEFAULT_COOKIE_HOST_ALLOWLIST,
    forceHttpOnly = true,
    forceSecure = true,
  } = opts;

  const pageUrl = assertHttpsUrl(url);
  if (!isHostAllowed(pageUrl.hostname, allowlist)) {
    throw new Error(
      `host not allowlisted for cookie inject: ${pageUrl.hostname}`
    );
  }

  let cookies = [];
  if (session?.cookies?.length) {
    cookies = session.cookies.map((c) => ({ ...c }));
  } else if (session?.cookie) {
    cookies = parseCookieInput(session.cookie);
  } else if (cookieHeader) {
    cookies = parseCookieInput(cookieHeader);
  }

  if (!cookies.length) {
    return { ok: false, error: "no cookies to inject", cookies: [], params: [] };
  }

  const params = [];
  const rejected = [];

  for (let c of cookies) {
    c = enforceSecureForXaiHosts(c);
    if (forceSecure) c.secure = true;
    if (forceHttpOnly) c.httpOnly = true;

    // Domain must be allowlisted if present
    if (c.domain && !isHostAllowed(c.domain, allowlist)) {
      rejected.push({ name: c.name, reason: "domain_not_allowlisted" });
      continue;
    }
    // Default domain to page host if missing
    if (!c.domain) {
      c = { ...c, domain: pageUrl.hostname };
    }

    const param = toBrowserCookieParams(c, {
      url: pageUrl.origin + (c.path || "/"),
      domain: c.domain,
      path: c.path || "/",
      secure: true,
    });

    // Final hard requirements
    param.httpOnly = forceHttpOnly ? true : Boolean(param.httpOnly);
    param.secure = true;
    if (!param.sameSite) param.sameSite = "Lax";

    params.push(param);
  }

  return {
    ok: params.length > 0,
    url: pageUrl.href,
    host: pageUrl.hostname,
    count: params.length,
    rejected,
    flags: cookieFlagsSummary(
      params.map((p) => ({
        name: p.name,
        httpOnly: p.httpOnly,
        secure: p.secure,
        sameSite: String(p.sameSite || "").toLowerCase(),
        path: p.path,
        domain: p.domain,
      }))
    ),
    params,
    // redacted names only for logs
    names: params.map((p) => p.name),
  };
}

/**
 * Inject using a CDP-like session:
 *   cdp = { send(method, params) }  // Network.setCookie / Network.clearBrowserCookies
 *
 * Or Playwright-like:
 *   context = { addCookies(params[]), clearCookies() }
 */
export async function injectCookiesSecure(target, planOrOpts) {
  const plan =
    planOrOpts?.params
      ? planOrOpts
      : buildSecureInjectPlan(planOrOpts || {});

  if (!plan.ok) {
    return { ok: false, error: plan.error || "inject plan failed", rejected: plan.rejected };
  }

  const clearFirst = planOrOpts?.clearFirst !== false;

  // Playwright context
  if (typeof target?.addCookies === "function") {
    if (clearFirst && typeof target.clearCookies === "function") {
      await target.clearCookies();
    }
    await target.addCookies(
      plan.params.map((p) => ({
        name: p.name,
        value: p.value,
        domain: p.domain,
        path: p.path || "/",
        httpOnly: true,
        secure: true,
        sameSite: p.sameSite || "Lax",
        expires: p.expires,
      }))
    );
    return {
      ok: true,
      via: "playwright",
      names: plan.names,
      count: plan.count,
    };
  }

  // CDP session
  if (typeof target?.send === "function") {
    if (clearFirst) {
      try {
        await target.send("Network.clearBrowserCookies");
      } catch {
        /* older targets */
      }
    }
    for (const p of plan.params) {
      await target.send("Network.setCookie", {
        name: p.name,
        value: p.value,
        domain: p.domain,
        path: p.path || "/",
        secure: true,
        httpOnly: true,
        sameSite: p.sameSite || "Lax",
        expires: p.expires,
        url: p.url,
      });
    }
    return {
      ok: true,
      via: "cdp",
      names: plan.names,
      count: plan.count,
    };
  }

  // Generic function (name, value, options) => void
  if (typeof target === "function") {
    for (const p of plan.params) {
      await target(p.name, p.value, {
        domain: p.domain,
        path: p.path,
        httpOnly: true,
        secure: true,
        sameSite: p.sameSite,
      });
    }
    return { ok: true, via: "fn", names: plan.names, count: plan.count };
  }

  return {
    ok: false,
    error: "target must be CDP session, Playwright context, or inject function",
  };
}

/**
 * Load web session from disk and inject into target.
 */
export async function injectStoredWebSession(target, cfg = {}, opts = {}) {
  const session = await loadWebSession(cfg);
  if (!session) {
    return { ok: false, error: "no web session stored — run xclaw auth web-import" };
  }
  const plan = buildSecureInjectPlan({
    session,
    url: opts.url || "https://grok.com",
    allowlist: opts.allowlist || cfg.auth?.web?.hostAllowlist,
    forceHttpOnly: opts.forceHttpOnly !== false,
    forceSecure: true,
  });
  return injectCookiesSecure(target, { ...plan, clearFirst: opts.clearFirst });
}

/**
 * Safe log line — never values
 */
export function formatInjectAudit(result) {
  if (!result) return "inject: null";
  if (!result.ok) return `inject: FAIL ${result.error || ""}`;
  return `inject: ok via=${result.via} count=${result.count} names=${(result.names || []).join(",")}`;
}
