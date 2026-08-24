/**
 * Real-browser (CDP) layer for xclaw_browser_tab — native engine.
 *
 * Materializes a registry tab into a live page in the managed headless
 * Chrome (chrome-session.mjs), then powers jsCode / screenshot / console
 * logs / multi-request network capture. This is the capability that used
 * to require the vendored CDP bundle (engine unification, ADR 0005).
 *
 * Event capture: on materialization we enable Runtime/Log/Network and
 * buffer console entries + network requests onto the tab record, capped,
 * so reads are cheap and nothing grows unbounded.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCdpClient } from "../../browser/cdp-client.mjs";
import { ensureChrome } from "../chrome-session.mjs";
import { assertUrlAllowed } from "../../security/ssrf.mjs";

const CONSOLE_CAP = 200;
const NETWORK_CAP = 200;
const BODY_PREVIEW_CAP = 8000;

export const SCREENSHOT_DIR =
  process.env.XCLAW_SCREENSHOT_DIR ||
  path.join(os.homedir(), ".xclaw", "screenshots");

const VIEWPORTS = {
  desktop: { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
};

function ssrfCfg() {
  return {
    security: {
      ssrf: {
        allowPrivate: process.env.XCLAW_SSRF_ALLOW_PRIVATE === "1",
      },
    },
  };
}

function pushCapped(arr, item, cap) {
  arr.push(item);
  if (arr.length > cap) arr.splice(0, arr.length - cap);
}

function previewOf(args) {
  return (args || [])
    .map((a) => {
      if (a == null) return String(a);
      if (a.value !== undefined) return typeof a.value === "string" ? a.value : JSON.stringify(a.value);
      return a.description || a.unserializableValue || `[${a.type || "object"}]`;
    })
    .join(" ")
    .slice(0, 500);
}

/**
 * Wire console + network event capture for an attached page onto the tab
 * record. Idempotent per attach handle.
 */
function wireEventCapture(tab, handle) {
  tab.console = tab.console || [];
  tab.network = tab.network || [];
  /** requestId → entry (still filling) */
  const inflight = new Map();

  handle.on("Runtime.consoleAPICalled", (p) => {
    pushCapped(
      tab.console,
      { type: p.type || "log", text: previewOf(p.args), at: new Date().toISOString() },
      CONSOLE_CAP
    );
  });
  handle.on("Runtime.exceptionThrown", (p) => {
    const d = p.exceptionDetails;
    pushCapped(
      tab.console,
      {
        type: "exception",
        text: (d?.exception?.description || d?.text || "uncaught exception").slice(0, 500),
        at: new Date().toISOString(),
      },
      CONSOLE_CAP
    );
  });
  handle.on("Log.entryAdded", (p) => {
    const e = p.entry || {};
    pushCapped(
      tab.console,
      { type: e.level || "log", source: e.source, text: String(e.text || "").slice(0, 500), at: new Date().toISOString() },
      CONSOLE_CAP
    );
  });

  handle.on("Network.requestWillBeSent", (p) => {
    const entry = {
      requestId: p.requestId,
      method: p.request?.method || "GET",
      url: p.request?.url,
      requestHeaders: p.request?.headers || {},
      resourceType: p.type || null,
      status: null,
      responseHeaders: {},
      responseBodyBytes: null,
      responseBodyPreview: null,
      at: new Date().toISOString(),
    };
    inflight.set(p.requestId, entry);
    pushCapped(tab.network, entry, NETWORK_CAP);
  });
  handle.on("Network.responseReceived", (p) => {
    const entry = inflight.get(p.requestId);
    if (!entry) return;
    entry.status = p.response?.status ?? null;
    entry.responseHeaders = p.response?.headers || {};
    entry.mimeType = p.response?.mimeType || null;
  });
  handle.on("Network.loadingFinished", (p) => {
    const entry = inflight.get(p.requestId);
    if (!entry) return;
    entry.responseBodyBytes = p.encodedDataLength ?? null;
    inflight.delete(p.requestId);
  });
  handle.on("Network.loadingFailed", (p) => {
    const entry = inflight.get(p.requestId);
    if (!entry) return;
    entry.error = p.errorText || "loading failed";
    inflight.delete(p.requestId);
  });
}

/**
 * Ensure the tab has a live CDP page (spawning managed Chrome on first use).
 * Navigates the page to tab.url when newly created or when navigate=true.
 *
 * @param {object} tab registry record from browser-tab-tool
 * @param {{ navigate?: boolean, url?: string, waitMs?: number }} [opts]
 * @returns {Promise<{ handle: object, created: boolean }>}
 */
export async function ensureTabPage(tab, opts = {}) {
  if (tab._cdp?.handle?.isOpen?.()) {
    if (opts.navigate && opts.url) {
      await cdpNavigate(tab, tab._cdp.handle, opts.url, opts.waitMs);
    }
    return { handle: tab._cdp.handle, created: false };
  }

  const ep = await ensureChrome();
  const client = createCdpClient({ host: ep.host, port: ep.port });

  let handle = null;
  // Re-attach to this tab's existing Chrome target if it survived.
  if (tab._cdp?.targetId) {
    try {
      handle = await client.attach((p) => p.id === tab._cdp.targetId);
      if (handle.page?.id !== tab._cdp.targetId) {
        handle.close();
        handle = null;
      }
    } catch {
      handle = null;
    }
  }

  let created = false;
  if (!handle) {
    const target = await client.newPage("about:blank");
    handle = await client.attach((p) => p.id === target.id);
    if (handle.page?.id !== target.id) {
      handle.close();
      throw new Error("CDP attach picked the wrong target after newPage");
    }
    created = true;
  }

  await handle.send("Runtime.enable");
  await handle.send("Log.enable");
  await handle.send("Network.enable");
  await handle.send("Page.enable");
  wireEventCapture(tab, handle);
  tab._cdp = { targetId: handle.page.id, handle };

  const url = opts.url || tab.url;
  if ((created || opts.navigate) && url && url !== "about:blank") {
    await cdpNavigate(tab, handle, url, opts.waitMs);
  }
  return { handle, created };
}

async function cdpNavigate(tab, handle, url, waitMs) {
  // Same SSRF policy as the fetch path (cloud metadata always blocked).
  // assertUrlAllowed reports a denial as { ok: false }; it never throws, so the
  // verdict has to be acted on or the navigation goes through unchecked.
  const verdict = await assertUrlAllowed(url, ssrfCfg(), { metadataFloor: true });
  if (verdict && verdict.ok === false) {
    throw new Error(`SSRF_BLOCKED: ${verdict.error || "destination not allowed"}`);
  }
  const loaded = new Promise((resolve) => {
    const un = handle.on("Page.loadEventFired", () => {
      un();
      resolve(true);
    });
    setTimeout(() => {
      un();
      resolve(false);
    }, Number(waitMs) || 10_000);
  });
  await handle.send("Page.navigate", { url });
  await loaded;
  try {
    tab.url = (await handle.evaluate("location.href")) || url;
    tab.title = (await handle.evaluate("document.title")) || tab.title || "";
  } catch {
    tab.url = url;
  }
}

/**
 * Run JavaScript in the tab's real page.
 * @returns {Promise<{ value: any, console: object[] }>}
 */
export async function runJsCode(tab, code, { timeoutMs = 15_000 } = {}) {
  const { handle } = await ensureTabPage(tab);
  const before = (tab.console || []).length;
  const value = await handle.evaluate(String(code), {
    awaitPromise: true,
    timeoutMs,
  });
  // Console entries emitted during this evaluation (best-effort slice).
  await new Promise((r) => setTimeout(r, 50));
  return { value, console: (tab.console || []).slice(before) };
}

/**
 * Capture full PNG screenshot(s), optionally under device emulation.
 * mode: "viewport" (default) | "desktop" | "mobile" | "both"
 * Full images are written to disk (they don't belong in model context);
 * the caller gets paths + sizes.
 */
export async function captureTabScreenshot(tab, mode = "viewport") {
  const { handle } = await ensureTabPage(tab);
  const m = String(mode || "viewport").toLowerCase();
  const wants =
    m === "both" ? ["desktop", "mobile"] : m === "mobile" || m === "desktop" ? [m] : [null];

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const shots = [];
  for (const viewport of wants) {
    if (viewport) {
      await handle.send("Emulation.setDeviceMetricsOverride", VIEWPORTS[viewport]);
      await new Promise((r) => setTimeout(r, 150));
    }
    const r = await handle.send("Page.captureScreenshot", { format: "png" });
    const buf = Buffer.from(r.data, "base64");
    const file = path.join(
      SCREENSHOT_DIR,
      `${tab.id}-${viewport || "viewport"}-${Date.now()}.png`
    );
    fs.writeFileSync(file, buf);
    shots.push({ viewport: viewport || "viewport", path: file, bytes: buf.length });
    if (viewport) {
      await handle.send("Emulation.clearDeviceMetricsOverride");
    }
  }
  return shots;
}

/** Real-DOM HTML for observe (falls back to fetch-cached HTML upstream). */
export async function readTabHtml(tab) {
  const { handle } = await ensureTabPage(tab);
  return String(
    (await handle.evaluate("document.documentElement.outerHTML")) || ""
  );
}

/** Extract text/title/links from the live DOM after js has run. */
export async function readTabDom(tab) {
  const { handle } = await ensureTabPage(tab);
  return {
    url: await handle.evaluate("location.href"),
    title: await handle.evaluate("document.title"),
    text: String(
      (await handle.evaluate("document.body ? document.body.innerText : ''")) || ""
    ).slice(0, 12000),
  };
}

/** Console buffer for a tab (populated once the tab is CDP-materialized). */
export function tabConsole(tab, limit = 100) {
  const all = tab.console || [];
  return all.slice(-Math.max(1, Math.min(limit, CONSOLE_CAP)));
}

export function isCdpTab(tab) {
  return Boolean(tab?._cdp?.handle?.isOpen?.());
}

/** Trim a network entry for details reads (bundle-parity shape). */
export function trimNetworkEntry(entry, includeBody = true) {
  if (!entry) return null;
  return {
    ...entry,
    responseBodyPreview: includeBody
      ? entry.responseBodyPreview == null
        ? null
        : String(entry.responseBodyPreview).slice(0, BODY_PREVIEW_CAP)
      : null,
  };
}

export default {
  ensureTabPage,
  runJsCode,
  captureTabScreenshot,
  readTabHtml,
  readTabDom,
  tabConsole,
  isCdpTab,
  SCREENSHOT_DIR,
};
