/**
 * xclaw_browser_tab — the single native browser plane (engine unification).
 *
 * Two tiers, one tool:
 *   - fetch tier (default navigate): SSRF-guarded HTTP fetch, redirect-aware;
 *     title/text/links extraction; observe → HTML-derived a11y-like tree.
 *     Cheap, no browser process.
 *   - CDP tier (jsCode / screenshot / click / type / console / render:true):
 *     lazily materializes the tab in the managed headless Chrome
 *     (chrome-session.mjs) and captures console + network events live.
 *
 * CUA policy: prefer observe (structure) before vision/screenshot; tools before GUI.
 *
 * @see docs/COMPUTER_USE_BACKEND.md
 */

import { safeFetch } from "../../security/ssrf.mjs";
import { beforeNavigate, beforeInput } from "../../browser/hooks.mjs";
import { cacheObserveResult, runComputerAct } from "./computer-act-tool.mjs";
import {
  ensureTabPage,
  runJsCode,
  captureTabScreenshot,
  readTabHtml,
  readTabDom,
  tabConsole,
  isCdpTab,
} from "./browser-cdp.mjs";

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
  const payload = {
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
  try {
    cacheObserveResult(tab.id, payload);
  } catch {
    /* optional cache */
  }
  return payload;
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
/**
 * Resolve or create the tab record and materialize it in the managed Chrome.
 * Used by every CDP-tier action (jsCode/screenshot/click/type/render).
 */
async function getOrCreateCdpTab(input = {}) {
  let tab = input.tabId ? tabs.get(input.tabId) : null;
  if (!tab && input.tabId && !input.url) {
    const err = new Error(`Unknown tabId: ${input.tabId}`);
    err.code = "UNKNOWN_TAB";
    throw err;
  }
  if (!tab) {
    tab = {
      id: nextId(),
      url: input.url || "about:blank",
      title: "",
      text: "",
      links: [],
      status: null,
      at: new Date().toISOString(),
      network: [],
      console: [],
    };
    tabs.set(tab.id, tab);
    await ensureTabPage(tab, { navigate: Boolean(input.url), url: input.url });
  } else if (input.url && input.url !== tab.url) {
    await ensureTabPage(tab, { navigate: true, url: input.url });
  } else {
    await ensureTabPage(tab);
  }
  return tab;
}

function cdpFailure(err, extra = {}) {
  return {
    ok: false,
    error: err?.message || String(err),
    code:
      err?.code === "UNKNOWN_TAB"
        ? "UNKNOWN_TAB"
        : /binary|chromium|chrome/i.test(String(err?.message))
          ? "CUA_BROWSER_UNAVAILABLE"
          : extra.code || "CUA_CDP_FAILED",
    engine: "native-cdp",
    ...extra,
    ...(extra.code ? { code: extra.code } : {}),
  };
}

/** Phase A enforcement (hooks.mjs) applied in-process, engine-side. */
function hookBlocked(gate, extra = {}) {
  return {
    ok: false,
    error: gate.reason || gate.code || "blocked by enforcement hooks",
    code: gate.code || "HOOKS_BLOCKED",
    phase: gate.phase,
    engine: "native-cdp",
    ...extra,
  };
}

export async function runBrowserTab(input = {}) {
  const action = String(input.action || "").toLowerCase();

  if (input.jsCode) {
    const gate = await beforeInput({ jsCode: input.jsCode, action: "jsCode", tabId: input.tabId });
    if (!gate.ok) return hookBlocked(gate, { tabId: input.tabId || null });
    try {
      const tab = await getOrCreateCdpTab(input);
      const timeoutMs = Math.min(
        Math.max(Number(input.jsTimeoutMs) || 15_000, 1000),
        60_000
      );
      const r = await runJsCode(tab, input.jsCode, { timeoutMs });
      return {
        ok: true,
        action: "jsCode",
        tabId: tab.id,
        url: tab.url,
        value: r.value,
        console: r.console,
        engine: "native-cdp",
      };
    } catch (err) {
      return cdpFailure(err, { tabId: input.tabId || null, code: err?.code === "UNKNOWN_TAB" ? "UNKNOWN_TAB" : "CUA_JS_FAILED" });
    }
  }
  if (input.screenshot) {
    try {
      const tab = await getOrCreateCdpTab(input);
      const shots = await captureTabScreenshot(tab, input.screenshot);
      return {
        ok: true,
        action: "screenshot",
        tabId: tab.id,
        url: tab.url,
        screenshots: shots,
        note: "Full PNG written to disk; read with file tools if vision is needed. Prefer action=observe for structure.",
        engine: "native-cdp",
      };
    } catch (err) {
      return cdpFailure(err, { tabId: input.tabId || null, code: err?.code === "UNKNOWN_TAB" ? "UNKNOWN_TAB" : "CUA_SCREENSHOT_FAILED" });
    }
  }
  if (input.click || input.type || action === "click" || action === "type") {
    const kind = Boolean(input.type) || action === "type" ? "type" : "click";
    const gate = await beforeInput({ action: kind, tabId: input.tabId });
    if (!gate.ok) return hookBlocked(gate, { tabId: input.tabId || null });
    try {
      const tab = await getOrCreateCdpTab(input);
      const isType = kind === "type";
      const clickSpec = String(input.click || input.ref || "").trim();
      const actInput = isType
        ? { action: "type", text: input.type || input.text || "" }
        : /^e\d+$/i.test(clickSpec)
          ? { action: "click", ref: clickSpec, tabId: tab.id }
          : Number.isFinite(Number(input.x)) && Number.isFinite(Number(input.y))
            ? { action: "click", x: Number(input.x), y: Number(input.y) }
            : { action: "click", label: clickSpec || input.label || "" };
      const res = await runComputerAct({
        ...actInput,
        urlMatch: tab._cdp?.targetId ? undefined : tab.url,
        targetId: tab._cdp?.targetId,
      });
      return { ...res, tabId: tab.id, url: tab.url };
    } catch (err) {
      return cdpFailure(err, { tabId: input.tabId || null, code: err?.code === "UNKNOWN_TAB" ? "UNKNOWN_TAB" : "CUA_ACT_FAILED" });
    }
  }

  if (action === "console") {
    const tab = tabs.get(input.tabId);
    if (!tab) {
      return { ok: false, error: `Unknown tabId: ${input.tabId || "(none)"}`, tabId: input.tabId || null, engine: "native-cdp" };
    }
    const entries = tabConsole(tab, Number(input.limit) || 100);
    return {
      ok: true,
      action: "console",
      tabId: tab.id,
      url: tab.url,
      entries,
      count: entries.length,
      engine: isCdpTab(tab) ? "native-cdp" : "native-fetch",
      ...(entries.length === 0 && !isCdpTab(tab)
        ? { note: "Console capture starts when the tab runs in the real browser (jsCode/screenshot/render:true)." }
        : {}),
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
    if (isCdpTab(tab)) {
      // Live DOM beats the fetch-time HTML snapshot (js may have run since).
      try {
        tab.html = (await readTabHtml(tab)).slice(0, 500_000);
      } catch {
        /* fall back to cached html */
      }
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
      error: "url required for navigate (or action=list|read|observe|console with tabId)",
      engine: "native-fetch",
    };
  }

  // Phase A enforcement: commit gates / role gates on every navigate tier.
  const navGate = await beforeNavigate({ url: input.url, tabId: input.tabId });
  if (!navGate.ok) return hookBlocked(navGate, { url: input.url });

  // Real-browser navigate (js executes, console + full network captured).
  if (input.render === true) {
    try {
      const tab = await getOrCreateCdpTab(input);
      const dom = await readTabDom(tab);
      tab.url = dom.url || tab.url;
      tab.title = dom.title || "";
      tab.text = dom.text || "";
      tab.html = (await readTabHtml(tab)).slice(0, 500_000);
      tab.links = extractLinks(tab.html, tab.url);
      tab.description = extractMetaDescription(tab.html);
      tab.status =
        tab.network.find((n) => n.resourceType === "Document")?.status ?? null;
      const out = {
        ok: true,
        action: "navigate",
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
        description: tab.description,
        status: tab.status,
        textPreview: tab.text.slice(0, 4000),
        links: tab.links.slice(0, 20),
        engine: "native-cdp",
        networkSummaries: input.includeNetwork
          ? tab.network.map((n) => ({
              requestId: n.requestId,
              method: n.method,
              url: n.url,
              status: n.status,
              resourceType: n.resourceType,
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
    } catch (err) {
      return cdpFailure(err, { url: input.url, code: "CUA_NAVIGATE_FAILED" });
    }
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
    "Browser plane (CUA-aware): navigate/fetch URL, list/read tabs, action=observe for structured interactive elements. render:true navigates in the managed headless Chrome (js executes, console + full network captured). jsCode runs JavaScript in the real page; screenshot captures full PNG to disk (viewport|desktop|mobile|both); click/type actuate via CDP; action=console reads captured logs. Prefer observe (structure) before screenshot. See docs/COMPUTER_USE_BACKEND.md.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description:
          "navigate | list | read | observe | console | click | type (default: navigate if url set). observe/console require tabId.",
      },
      url: { type: "string", description: "URL for navigate" },
      tabId: { type: "string", description: "Tab id for read/observe/console targeting" },
      render: {
        type: "boolean",
        description:
          "Navigate in the real headless browser instead of plain fetch (runs js, captures console+network)",
      },
      observe: {
        type: "boolean",
        description: "If true on navigate, also return elements[] (same as action=observe)",
      },
      jsCode: {
        type: "string",
        description: "JavaScript to run in the tab's real page; returns the expression value",
      },
      jsTimeoutMs: { type: "number", description: "jsCode timeout (default 15000, max 60000)" },
      screenshot: {
        type: "string",
        description:
          "Capture full PNG to disk: viewport | desktop | mobile | both — prefer action=observe for structure",
      },
      includeNetwork: { type: "boolean" },
      click: { type: "string", description: "Element ref (eN from observe) or label text to click" },
      type: { type: "string", description: "Text to type into the focused element" },
      x: { type: "number", description: "Explicit click x (with y)" },
      y: { type: "number", description: "Explicit click y (with x)" },
      limit: { type: "number", description: "Max console entries for action=console (default 100)" },
    },
  },
  // Read-only relative to the LOCAL system: page actuation never touches
  // host files/processes, matching the previous risk posture of this tool.
  isReadOnly: () => true,
  async call(input, _context = {}) {
    const data = await runBrowserTab(input || {});
    return { data };
  },
};

export default BrowserTabTool;
