/**
 * CLEAN xclaw_browser_network_details — native implementation (Strategy C).
 *
 * Works with native-fetch tab registry from browser-tab-tool.mjs.
 * Full CDP multi-request capture remains richer in the bundle engine;
 * native covers the primary navigation request recorded at navigate time.
 */
import {
  getTab,
  getNetworkEntry,
  listTabNetwork,
} from "./browser-tab-tool.mjs";

/**
 * @param {object} input
 * @param {string} input.tabId
 * @param {string} [input.requestId]
 * @param {boolean} [input.includeBody=true]
 */
export async function runBrowserNetworkDetails(input = {}) {
  const tabId = String(input.tabId || "").trim();
  if (!tabId) {
    return {
      ok: false,
      error: "tabId is required",
      engine: "native-fetch",
    };
  }
  const tab = getTab(tabId);
  if (!tab) {
    return {
      ok: false,
      error: `Unknown tabId: ${tabId}`,
      tabId,
      engine: "native-fetch",
      hint: "Navigate with xclaw_browser_tab first (native engine).",
    };
  }

  const requestId = input.requestId ? String(input.requestId) : null;
  const entry = getNetworkEntry(tabId, requestId);
  if (!entry) {
    return {
      ok: false,
      error: requestId
        ? `No network entry requestId=${requestId} on tab ${tabId}`
        : `No network entries on tab ${tabId}`,
      tabId,
      available: listTabNetwork(tabId)?.map((n) => n.requestId) || [],
      engine: "native-fetch",
    };
  }

  const includeBody = input.includeBody !== false;
  return {
    ok: true,
    engine: "native-fetch",
    tabId,
    requestId: entry.requestId,
    method: entry.method,
    url: entry.url,
    status: entry.status,
    requestHeaders: entry.requestHeaders || {},
    responseHeaders: entry.responseHeaders || {},
    responseBodyBytes: entry.responseBodyBytes ?? null,
    responseBodyPreview: includeBody ? entry.responseBodyPreview || null : null,
    at: entry.at,
    note:
      "Native engine records the primary navigation request. Multi-resource CDP capture requires computer.engine=bundle.",
  };
}

export const BrowserNetworkDetailsTool = {
  name: "xclaw_browser_network_details",
  description:
    "Inspect network details for a native browser tab (headers, status, body preview). Requires prior xclaw_browser_tab navigate.",
  inputSchema: {
    type: "object",
    properties: {
      tabId: { type: "string", description: "Tab id from xclaw_browser_tab" },
      requestId: {
        type: "string",
        description: "Optional request id; defaults to latest on the tab",
      },
      includeBody: {
        type: "boolean",
        description: "Include response body preview (default true, capped)",
      },
    },
    required: ["tabId"],
  },
  isReadOnly: () => true,
  async call(input, _ctx = {}) {
    const data = await runBrowserNetworkDetails(input || {});
    return { data };
  },
};

export default BrowserNetworkDetailsTool;
