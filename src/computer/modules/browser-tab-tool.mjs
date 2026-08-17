/**
 * CLEAN xclaw_browser_tab — lightweight native implementation (P0→P1 + CUA observe).
 *
 * Full CDP/Chrome path lives in the bundle engine (XCLAW_COMPUTER_ENGINE=bundle).
 * Native engine:
 *   - navigate/fetch URL (redirect-aware)
 *   - tab registry (list / read / observe)
 *   - title, text, links extraction
 *   - observe → structured element candidates (HTML-derived a11y-like tree)
 *   - jsCode/screenshot/click → clear error pointing at bundle/CDP
 *
 * CUA policy: prefer observe (structure) before vision/screenshot; tools before GUI.
 *
 * @see docs/BROWSER_UNBUNDLE.md
 * @see docs/COMPUTER_USE_BACKEND.md
 */

import { safeFetch } from "../../security/ssrf.mjs";

/** @type {Map<string, { id: string, url: string, title: string, text: string, links: object[], status: number, at: string }>} */
const tabs = new Map();
let seq = 0;

function nextId() {
  seq += 1;
  return `tab_${seq}_${Date.now().toString(36)}`;
}

/**
 * SSRF policy for the native browser. The computer server runs in its own
 * process, so policy arrives via env (the manager forwards it from config):
 *   XCLAW_SSRF=off|block            — guard mode (default block)
 *   XCLAW_SSRF_ALLOW_PRIVATE=1      — permit loopback/private (lab dev)
 * Cloud-metadata endpoints stay blocked in EVERY mode (metadataFloor).
 */
function ssrfCfg() {
  return {
    security: {
      ssrf: {
        allowPrivate: process.env.XCLAW_SSRF_ALLOW_PRIVATE === "1",
      },
    },
  };
}

/**
 * GET with SSRF-validated redirect follow (each hop re-checked, connection
 * pinned to the validated IP; cloud metadata unconditionally blocked).
 */
async function fetchUrl(urlStr, timeoutMs = 15000) {
  const res = await safeFetch(
    urlStr,
    {
      headers: {
        "user-agent":
          "XClawNativeBrowser/3.75 (+https://github.com/Matrixx0070/xclaw; native-fetch)",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      timeoutMs,
      maxBytes: 2_000_000,
    },
    ssrfCfg(),
    { metadataFloor: true }
  );
  return {
    status: res.status,
    body: await res.text(),
    finalUrl: res.url || urlStr,
  };
}

function extractTitle(html) {
  const m = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 200) : "";
}

function extractMetaDescription(html) {
  const m = String(html).match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
  ) || String(html).match(
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i
  );
  return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 500) : "";
}

function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12000);
}

function extractLinks(html, baseUrl, limit = 30) {
  const links = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && links.length < limit) {
    let href = m[1];
    const label = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
    try {
      href = new URL(href, baseUrl).href;
    } catch {
      continue;
    }
    if (href.startsWith("http://") || href.startsWith("https://")) {
      links.push({ href, label: label || null });
    }
  }
  return links;
}

/**
 * Poor-man's accessibility tree from HTML (native engine).
 * Prefer this over screenshot for planning; CDP bundle can replace with real AX.
 * @param {string} html
 * @param {string} baseUrl
 * @param {number} [limit=40]
 */
export function extractInteractiveElements(html, baseUrl, limit = 40) {
  const elements = [];
  const push = (el) => {
    if (elements.length >= limit) return;
    elements.push(el);
  };
  const strip = (s) =>
    String(s || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);

  // anchors
  const aRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = aRe.exec(html)) && elements.length < limit) {
    const attrs = m[1];
    const hrefM = attrs.match(/href=["']([^"']+)["']/i);
    let href = hrefM ? hrefM[1] : null;
    if (href) {
      try {
        href = new URL(href, baseUrl).href;
      } catch {
        /* keep raw */
      }
    }
    const name =
      strip(m[2]) ||
      (attrs.match(/aria-label=["']([^"']+)["']/i) || [])[1] ||
      (attrs.match(/title=["']([^"']+)["']/i) || [])[1] ||
      href ||
      "link";
    push({
      ref: `e${elements.length + 1}`,
      role: "link",
      name,
      href: href || undefined,
      tag: "a",
    });
  }

  // buttons
  const btnRe = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  while ((m = btnRe.exec(html)) && elements.length < limit) {
    const attrs = m[1];
    const name =
      strip(m[2]) ||
      (attrs.match(/aria-label=["']([^"']+)["']/i) || [])[1] ||
      (attrs.match(/name=["']([^"']+)["']/i) || [])[1] ||
      "button";
    const disabled = /\bdisabled\b/i.test(attrs);
    push({
      ref: `e${elements.length + 1}`,
      role: "button",
      name,
      disabled: disabled || undefined,
      tag: "button",
    });
  }

  // inputs / textarea / select
  const inputRe = /<(input|textarea|select)\b([^>]*)\/?>/gi;
  while ((m = inputRe.exec(html)) && elements.length < limit) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const typeM = attrs.match(/\btype=["']([^"']+)["']/i);
    const type = (typeM ? typeM[1] : tag === "input" ? "text" : tag).toLowerCase();
    if (type === "hidden") continue;
    const name =
      (attrs.match(/aria-label=["']([^"']+)["']/i) || [])[1] ||
      (attrs.match(/placeholder=["']([^"']+)["']/i) || [])[1] ||
      (attrs.match(/\bname=["']([^"']+)["']/i) || [])[1] ||
      (attrs.match(/\bid=["']([^"']+)["']/i) || [])[1] ||
      type;
    const role =
      type === "submit" || type === "button"
        ? "button"
        : type === "checkbox"
          ? "checkbox"
          : type === "radio"
            ? "radio"
            : tag === "select"
              ? "combobox"
              : "textbox";
    push({
      ref: `e${elements.length + 1}`,
      role,
      name: strip(name),
      tag,
      inputType: type !== tag ? type : undefined,
    });
  }

  return elements;
}

/**
 * Build CUA-style observe payload from a stored tab (native HTML path).
 * @param {object} tab
 */
export function observeFromTab(tab) {
  const html = tab.html || "";
  const elements = html
    ? extractInteractiveElements(html, tab.url || "https://example.invalid")
    : (tab.links || []).map((l, i) => ({
        ref: `e${i + 1}`,
        role: "link",
        name: l.label || l.href,
        href: l.href,
        tag: "a",
      }));
  return {
    ok: true,
    action: "observe",
    tabId: tab.id,
    url: tab.url,
    title: tab.title,
    status: tab.status,
    engine: "native-fetch",
    mode: "html-structure",
    /** Structured candidates — prefer over screenshot for planning */
    elements,
    elementCount: elements.length,
    textPreview: String(tab.text || "").slice(0, 3000),
    links: (tab.links || []).slice(0, 15),
    notes:
      "Native observe is HTML-derived (not OS accessibility). For real AX tree + click/type use XCLAW_COMPUTER_ENGINE=bundle or CDP attach.",
  };
}

function listTabs() {
  return [...tabs.values()].map((t) => ({
    tabId: t.id,
    url: t.url,
    title: t.title,
    status: t.status,
    at: t.at,
  }));
}

/**
 * @param {object} input
 * @param {string} [input.action] navigate|list|read|observe (default: navigate if url, else list)
 * @param {string} [input.url]
 * @param {string} [input.tabId]
 * @param {string} [input.jsCode]
 * @param {boolean} [input.includeNetwork]
 * @param {string} [input.screenshot]
 * @param {string} [input.click]  — not supported on native
 * @param {string} [input.type]   — not supported on native
 */
export async function runBrowserTab(input = {}) {
  const action = String(input.action || "").toLowerCase();

  if (input.jsCode) {
    return {
      ok: false,
      error:
        "jsCode requires the CDP bundle engine. Set XCLAW_COMPUTER_ENGINE=bundle (npm run fetch:bundle). See docs/BROWSER_UNBUNDLE.md",
      tabId: input.tabId || null,
      engine: "native-fetch",
    };
  }
  if (input.screenshot) {
    return {
      ok: false,
      error:
        "screenshot requires the CDP bundle engine. Prefer action=observe on native for structure. See docs/BROWSER_UNBUNDLE.md",
      tabId: input.tabId || null,
      engine: "native-fetch",
    };
  }
  if (input.click || input.type || action === "click" || action === "type") {
    return {
      ok: false,
      error:
        "click/type require CDP bundle or attached Chromium (XCLAW_CDP_URL). On native, use action=observe then tools/API; do not invent coordinates.",
      tabId: input.tabId || null,
      engine: "native-fetch",
      code: "CUA_ACT_REQUIRES_BUNDLE",
    };
  }

  if (action === "list" || (!input.url && !input.tabId && action !== "read" && action !== "observe")) {
    return {
      ok: true,
      action: "list",
      tabs: listTabs(),
      count: tabs.size,
      engine: "native-fetch",
    };
  }

  if (action === "observe") {
    if (!input.tabId) {
      return {
        ok: false,
        error: "observe requires tabId (navigate first)",
        engine: "native-fetch",
      };
    }
    const tab = tabs.get(input.tabId);
    if (!tab) {
      return { ok: false, error: `Unknown tabId: ${input.tabId}`, tabId: input.tabId };
    }
    return observeFromTab(tab);
  }

  if (action === "read" || (input.tabId && !input.url && action !== "observe")) {
    const tab = tabs.get(input.tabId);
    if (!tab) {
      return { ok: false, error: `Unknown tabId: ${input.tabId}`, tabId: input.tabId };
    }
    return {
      ok: true,
      action: "read",
      tabId: tab.id,
      url: tab.url,
      title: tab.title,
      description: tab.description || "",
      status: tab.status,
      textPreview: tab.text.slice(0, 4000),
      links: tab.links || [],
      engine: "native-fetch",
    };
  }

  if (!input.url) {
    return {
      ok: false,
      error: "url required for navigate (or action=list|read|observe with tabId)",
      engine: "native-fetch",
    };
  }

  let res;
  try {
    res = await fetchUrl(input.url);
  } catch (err) {
    return {
      ok: false,
      error: err?.message || String(err),
      code: err?.code || null,
      url: input.url,
      engine: "native-fetch",
    };
  }
  const title = extractTitle(res.body);
  const description = extractMetaDescription(res.body);
  const text = htmlToText(res.body);
  const links = extractLinks(res.body, res.finalUrl || input.url);
  const id = input.tabId && tabs.has(input.tabId) ? input.tabId : nextId();
  const finalUrl = res.finalUrl || input.url;
  const requestId = `req_${id}`;
  const networkEntry = {
    requestId,
    method: "GET",
    url: finalUrl,
    status: res.status,
    requestHeaders: {
      "user-agent": "XClawNativeBrowser/3.75",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    responseHeaders: {
      "content-type": "text/html; charset=utf-8",
    },
    responseBodyPreview: String(res.body || "").slice(0, 8000),
    responseBodyBytes: Buffer.byteLength(String(res.body || ""), "utf8"),
    at: new Date().toISOString(),
  };

  const tab = {
    id,
    url: finalUrl,
    title,
    description,
    text,
    links,
    /** keep HTML for observe (capped) */
    html: String(res.body || "").slice(0, 500_000),
    status: res.status,
    at: new Date().toISOString(),
    network: [networkEntry],
  };
  tabs.set(id, tab);

  const out = {
    ok: true,
    action: "navigate",
    tabId: id,
    url: tab.url,
    title: tab.title,
    description: tab.description,
    status: tab.status,
    textPreview: tab.text.slice(0, 4000),
    links: links.slice(0, 20),
    engine: "native-fetch",
    networkSummaries: input.includeNetwork
      ? tab.network.map((n) => ({
          requestId: n.requestId,
          method: n.method,
          url: n.url,
          status: n.status,
        }))
      : undefined,
  };
  if (input.observe === true || action === "navigate_observe") {
    const obs = observeFromTab(tab);
    out.elements = obs.elements;
    out.elementCount = obs.elementCount;
    out.mode = obs.mode;
  }
  return out;
}

/** Shared accessors for network-details + tests */
export function getTab(tabId) {
  return tabs.get(tabId) || null;
}

export function listTabNetwork(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) return null;
  return tab.network || [];
}

export function getNetworkEntry(tabId, requestId) {
  const list = listTabNetwork(tabId);
  if (!list) return null;
  if (requestId) return list.find((n) => n.requestId === requestId) || null;
  return list[list.length - 1] || null;
}

/** Test helper */
export function _resetTabsForTests() {
  tabs.clear();
  seq = 0;
}

export const BrowserTabTool = {
  name: "xclaw_browser_tab",
  description:
    "Browser plane (CUA-aware): navigate/fetch URL, list/read tabs, action=observe for structured interactive elements (HTML a11y-like tree). Prefer observe before screenshot. jsCode/screenshot/click/type require CDP bundle (XCLAW_COMPUTER_ENGINE=bundle or XCLAW_CDP_URL). See docs/BROWSER_UNBUNDLE.md and docs/COMPUTER_USE_BACKEND.md.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description:
          "navigate | list | read | observe (default: navigate if url set). observe requires tabId.",
      },
      url: { type: "string", description: "URL for navigate" },
      tabId: { type: "string", description: "Tab id for read/observe/list targeting" },
      observe: {
        type: "boolean",
        description: "If true on navigate, also return elements[] (same as action=observe)",
      },
      jsCode: { type: "string", description: "Bundle/CDP only" },
      screenshot: { type: "string", description: "Bundle/CDP only — prefer action=observe on native" },
      includeNetwork: { type: "boolean" },
      click: { type: "string", description: "Bundle/CDP only" },
      type: { type: "string", description: "Bundle/CDP only" },
    },
  },
  isReadOnly: () => true,
  async call(input, _context = {}) {
    const data = await runBrowserTab(input || {});
    return { data };
  },
};

export default BrowserTabTool;
