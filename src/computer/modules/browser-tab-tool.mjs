/**
 * CLEAN xclaw_browser_tab — lightweight native implementation (P0→P1).
 *
 * Full CDP/Chrome path remains in browser-service.mjs + bundle.
 * Native engine:
 *   - navigate/fetch URL (redirect-aware)
 *   - tab registry (list / read)
 *   - title, text, links extraction
 *   - jsCode/screenshot → clear error pointing at bundle/CDP
 *
 * @see docs/BROWSER_UNBUNDLE.md
 */

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

/** @type {Map<string, { id: string, url: string, title: string, text: string, links: object[], status: number, at: string }>} */
const tabs = new Map();
let seq = 0;

function nextId() {
  seq += 1;
  return `tab_${seq}_${Date.now().toString(36)}`;
}

/**
 * GET with redirect follow (max 5).
 */
function fetchUrl(urlStr, timeoutMs = 15000, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch (e) {
      reject(e);
      return;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      reject(new Error(`Unsupported protocol: ${u.protocol}`));
      return;
    }
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      urlStr,
      {
        method: "GET",
        headers: {
          "user-agent":
            "XClawNativeBrowser/3.75 (+https://github.com/Matrixx0070/xclaw; native-fetch)",
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
        },
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode || 0;
        if (
          redirectsLeft > 0 &&
          status >= 300 &&
          status < 400 &&
          res.headers.location
        ) {
          res.resume();
          let next;
          try {
            next = new URL(res.headers.location, urlStr).href;
          } catch (e) {
            reject(e);
            return;
          }
          fetchUrl(next, timeoutMs, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        const chunks = [];
        let size = 0;
        const max = 2_000_000;
        res.on("data", (c) => {
          if (size < max) {
            chunks.push(c);
            size += c.length;
          }
        });
        res.on("end", () => {
          resolve({
            status,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            finalUrl: urlStr,
          });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(Object.assign(new Error("fetch timeout"), { code: "ETIMEDOUT" }));
    });
    req.end();
  });
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
        "jsCode requires CDP/BrowserService. Use XCLAW_COMPUTER_ENGINE=bundle or wire browser-service. See docs/BROWSER_UNBUNDLE.md",
      tabId: input.tabId || null,
      engine: "native-fetch",
    };
  }
  if (input.screenshot) {
    return {
      ok: false,
      error:
        "screenshot requires CDP/BrowserService. Native browser_tab does not capture images. See docs/BROWSER_UNBUNDLE.md",
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

  const res = await fetchUrl(input.url);
  const title = extractTitle(res.body);
  const description = extractMetaDescription(res.body);
  const text = htmlToText(res.body);
  const links = extractLinks(res.body, res.finalUrl || input.url);
  const id = input.tabId && tabs.has(input.tabId) ? input.tabId : nextId();
  const tab = {
    id,
    url: res.finalUrl || input.url,
    title,
    description,
    text,
    links,
    status: res.status,
    at: new Date().toISOString(),
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
      ? [
          {
            requestId: "nav1",
            method: "GET",
            url: tab.url,
            status: tab.status,
          },
        ]
      : undefined,
  };
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
