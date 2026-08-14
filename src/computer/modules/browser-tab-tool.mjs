/**
 * CLEAN xclaw_browser_tab — lightweight native implementation (P0→P1).
 *
 * Full CDP/Chrome path lives in the bundle engine (XCLAW_COMPUTER_ENGINE=bundle).
 * Native engine:
 *   - navigate/fetch URL (redirect-aware)
 *   - tab registry (list / read)
 *   - title, text, links extraction
 *   - jsCode/screenshot → clear error pointing at bundle/CDP
 *
 * @see docs/BROWSER_UNBUNDLE.md
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
 * @param {string} [input.action] navigate|list|read (default: navigate if url, else list/read)
 * @param {string} [input.url]
 * @param {string} [input.tabId]
 * @param {string} [input.jsCode]
 * @param {boolean} [input.includeNetwork]
 * @param {string} [input.screenshot]
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
        "screenshot requires the CDP bundle engine. Native browser_tab does not capture images. See docs/BROWSER_UNBUNDLE.md",
      tabId: input.tabId || null,
      engine: "native-fetch",
    };
  }

  if (action === "list" || (!input.url && !input.tabId && action !== "read")) {
    return {
      ok: true,
      action: "list",
      tabs: listTabs(),
      count: tabs.size,
      engine: "native-fetch",
    };
  }

  if (action === "read" || (input.tabId && !input.url)) {
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
      error: "url required for navigate (or action=list|read with tabId)",
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
    status: res.status,
    at: new Date().toISOString(),
    network: [networkEntry],
  };
  tabs.set(id, tab);

  return {
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
    "Lightweight native browser: navigate/fetch URL, list/read tabs, extract title/text/links. jsCode and screenshot require CDP bundle (see docs/BROWSER_UNBUNDLE.md).",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "navigate | list | read (default: navigate if url set)",
      },
      url: { type: "string" },
      tabId: { type: "string" },
      jsCode: { type: "string" },
      screenshot: { type: "string" },
      includeNetwork: { type: "boolean" },
    },
  },
  isReadOnly: () => true,
  async call(input, _context = {}) {
    const data = await runBrowserTab(input || {});
    return { data };
  },
};

export default BrowserTabTool;
