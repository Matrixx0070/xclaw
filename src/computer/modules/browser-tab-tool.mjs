/**
 * CLEAN xclaw_browser_tab — lightweight native implementation (P0).
 *
 * Full CDP/Chrome path remains in browser-service.mjs + bundle.
 * This module provides a maintainable, dependency-light tool:
 *   - open/fetch URL → extract title + text
 *   - tab registry (in-process)
 *   - optional jsCode not supported without CDP (clear error)
 *
 * Upgrade path: swap execute body to BrowserService when wired.
 */

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

/** @type {Map<string, { id: string, url: string, title: string, text: string, at: string }>} */
const tabs = new Map();
let seq = 0;

function nextId() {
  seq += 1;
  return `tab_${seq}_${Date.now().toString(36)}`;
}

function fetchUrl(urlStr, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch (e) {
      reject(e);
      return;
    }
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      urlStr,
      {
        method: "GET",
        headers: {
          "user-agent":
            "XClawNativeBrowser/3.70 (+https://xclaw; lightweight-fetch)",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        timeout: timeoutMs,
      },
      (res) => {
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
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
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

function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12000);
}

/**
 * @param {object} input
 * @param {string} [input.url]
 * @param {string} [input.tabId]
 * @param {string} [input.jsCode]
 * @param {boolean} [input.includeNetwork]
 * @param {string} [input.screenshot]
 */
export async function runBrowserTab(input = {}) {
  if (input.jsCode) {
    return {
      ok: false,
      error:
        "jsCode requires CDP/BrowserService. Native lightweight browser_tab only supports url load/fetch. Set computer to full bundle or wire browser-service.",
      tabId: input.tabId || null,
    };
  }
  if (input.screenshot) {
    return {
      ok: false,
      error:
        "screenshot requires CDP/BrowserService. Native lightweight browser_tab does not capture images yet.",
      tabId: input.tabId || null,
    };
  }

  let tab = input.tabId ? tabs.get(input.tabId) : null;
  if (input.tabId && !tab) {
    return {
      ok: false,
      error: `Unknown tabId: ${input.tabId}`,
      tabId: input.tabId,
    };
  }

  if (input.url) {
    const res = await fetchUrl(input.url);
    const title = extractTitle(res.body);
    const text = htmlToText(res.body);
    const id = tab?.id || nextId();
    tab = {
      id,
      url: input.url,
      title,
      text,
      status: res.status,
      at: new Date().toISOString(),
    };
    tabs.set(id, tab);
    return {
      ok: true,
      tabId: id,
      url: tab.url,
      title: tab.title,
      status: tab.status,
      textPreview: tab.text.slice(0, 4000),
      engine: "native-fetch",
      networkSummaries: input.includeNetwork
        ? [
            {
              requestId: "nav1",
              method: "GET",
              url: input.url,
              status: res.status,
            },
          ]
        : undefined,
    };
  }

  if (tab) {
    return {
      ok: true,
      tabId: tab.id,
      url: tab.url,
      title: tab.title,
      textPreview: tab.text.slice(0, 4000),
      engine: "native-fetch",
    };
  }

  return {
    ok: false,
    error: "Provide url to open a tab (native lightweight mode)",
  };
}

export const BrowserTabTool = {
  name: "xclaw_browser_tab",
  description:
    "Loads a URL into a lightweight native tab (fetch + text extract). Full JS/screenshot needs BrowserService/CDP.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string" },
      tabId: { type: "string" },
      jsCode: { type: "string" },
      includeNetwork: { type: "boolean" },
      screenshot: { type: "string", description: "mobile|desktop|both (requires CDP)" },
    },
  },
  isReadOnly: () => false,
  async call(input, context = {}) {
    return { data: await runBrowserTab(input, context) };
  },
};

export function listNativeTabs() {
  return [...tabs.values()];
}

export default BrowserTabTool;
