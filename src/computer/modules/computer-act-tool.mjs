/**
 * I2 — unified computer actuation (CUA) on existing planes.
 *
 * Policy: tools → observe → GUI act.
 *
 * Paths:
 *   1) XCLAW_CDP_URL / CDP_URL set → Horizon motor + cdp-client (CLEAN)
 *   2) engine=bundle without CDP URL → honest NOT_EXTRACTED (BrowserService still bundle-only)
 *   3) native/thin without CDP → CUA_ACT_REQUIRES_BUNDLE
 */

import { createCdpClient } from "../../browser/cdp-client.mjs";
import { planClick, planType, planScroll, executeSteps } from "../../browser/motor.mjs";
import { runDesktopAct, probeDesktopDriver } from "./desktop-driver.mjs";

/** @type {Map<string, { elements: object[], at: number, url?: string }>} */
const observeCache = new Map();

/**
 * Cache observe results so computer_act can resolve ref → name → coords.
 * Called by browser-tab observe or external callers.
 */
export function cacheObserveResult(tabId, payload = {}) {
  if (!tabId) return;
  observeCache.set(String(tabId), {
    elements: Array.isArray(payload.elements) ? payload.elements : [],
    at: Date.now(),
    url: payload.url,
  });
  if (observeCache.size > 32) {
    const first = observeCache.keys().next().value;
    observeCache.delete(first);
  }
}

export function getCachedObserve(tabId) {
  return tabId ? observeCache.get(String(tabId)) || null : null;
}

/**
 * Resolve click coordinates from explicit x,y or observe ref via CDP evaluate.
 * @param {object} tab CDP attached page client
 * @param {object} input
 */
async function resolveClickTarget(tab, input = {}) {
  let x = Number(input.x);
  let y = Number(input.y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return { x, y, source: "explicit" };
  }

  const ref = input.ref ? String(input.ref) : "";
  const nameHint = input.label || input.name || "";
  let searchName = nameHint;

  if (ref && input.tabId) {
    const cached = getCachedObserve(input.tabId);
    const el = cached?.elements?.find((e) => e.ref === ref);
    if (el?.name) searchName = el.name;
  }

  if (!ref && !searchName) {
    return null;
  }

  // CDP: find element by ref index eN or by accessible name / text
  const expr = `(() => {
    const ref = ${JSON.stringify(ref)};
    const name = ${JSON.stringify(searchName)};
    const candidates = [];
    const push = (node, role) => {
      if (!node) return;
      const r = node.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const label = (node.getAttribute('aria-label') || node.innerText || node.value || node.getAttribute('name') || node.getAttribute('placeholder') || '').trim().slice(0, 160);
      candidates.push({ role, label, x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height });
    };
    document.querySelectorAll('a,button,input,textarea,select,[role="button"],[role="link"]').forEach((n) => {
      const role = n.getAttribute('role') || n.tagName.toLowerCase();
      push(n, role);
    });
    let hit = null;
    if (ref && /^e\d+$/i.test(ref)) {
      const idx = parseInt(ref.slice(1), 10) - 1;
      if (idx >= 0 && idx < candidates.length) hit = candidates[idx];
    }
    if (!hit && name) {
      const lower = name.toLowerCase();
      hit = candidates.find((c) => c.label.toLowerCase().includes(lower)) || null;
    }
    return hit;
  })()`;

  try {
    const hit = await tab.evaluate(expr);
    if (hit && Number.isFinite(hit.x) && Number.isFinite(hit.y)) {
      return { x: hit.x, y: hit.y, source: "cdp-ref", label: hit.label, role: hit.role };
    }
  } catch (e) {
    return { error: e?.message || String(e) };
  }
  return null;
}

function parseCdpUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(String(raw));
    return {
      host: u.hostname || "127.0.0.1",
      port: Number(u.port) || 9222,
    };
  } catch {
    return null;
  }
}

function resolveCdpEndpoint() {
  const raw = process.env.XCLAW_CDP_URL || process.env.CDP_URL || null;
  return parseCdpUrl(raw);
}

/**
 * @param {object} input
 * @param {string} [input.action] click|type|key|scroll|screenshot|observe
 * @param {string} [input.tabId] ignored on raw CDP attach (matches first/url page)
 * @param {string} [input.urlMatch] substring to pick CDP page
 * @param {string} [input.ref] reserved for future observe→coords mapping
 * @param {number} [input.x]
 * @param {number} [input.y]
 * @param {string} [input.text]
 * @param {string} [input.key]
 * @param {number} [input.deltaX]
 * @param {number} [input.deltaY]
 */
export async function runComputerAct(input = {}) {
  const action = String(input.action || "click").toLowerCase();

  if (action === "observe") {
    return {
      ok: false,
      error:
        "Use xclaw_browser_tab with action=observe (structure). computer_act is for GUI actuation only.",
      code: "USE_BROWSER_OBSERVE",
      engine: process.env.XCLAW_COMPUTER_ENGINE || "native",
    };
  }

  // Desktop surface (opt-in) — last resort after tools/browser
  if (input.surface === "desktop" || input.desktop === true) {
    return runDesktopAct(input);
  }

  const engine = process.env.XCLAW_COMPUTER_ENGINE || "native";
  const cdpEp = resolveCdpEndpoint();
  const canAct = Boolean(cdpEp) || engine === "bundle" || engine === "generated";

  if (!canAct) {
    return {
      ok: false,
      error:
        "GUI actuation (click/type/key/scroll/screenshot) requires XCLAW_CDP_URL or CDP bundle. Prefer tools/APIs, then xclaw_browser_tab action=observe.",
      code: "CUA_ACT_REQUIRES_BUNDLE",
      engine: engine === "thin" ? "native" : engine,
      cuaPolicy: "tools_first_then_observe_then_gui",
      hint: "export XCLAW_CDP_URL=http://127.0.0.1:9222  # or XCLAW_COMPUTER_ENGINE=bundle",
    };
  }

  // Prefer explicit CDP attach (CLEAN path). Bundle-without-CDP stays deferred.
  if (!cdpEp) {
    return {
      ok: false,
      error:
        "engine=bundle without XCLAW_CDP_URL: BrowserService actuation is still BUNDLE_ONLY. Attach CDP for CLEAN motor path, or extract BrowserService modules.",
      code: "CUA_ACT_NOT_EXTRACTED",
      engine,
      cuaPolicy: "tools_first_then_observe_then_gui",
      hint: "export XCLAW_CDP_URL=http://127.0.0.1:9222",
    };
  }

  let client;
  let tab;
  try {
    client = createCdpClient({ host: cdpEp.host, port: cdpEp.port });
    tab = await client.attach(input.urlMatch || undefined);
  } catch (e) {
    return {
      ok: false,
      error: `CDP attach failed: ${e?.message || e}`,
      code: "CDP_ATTACH_FAILED",
      engine,
      cdp: cdpEp,
    };
  }

  try {
    if (action === "screenshot") {
      const buf = await tab.screenshot();
      const b64 = buf.toString("base64");
      return {
        ok: true,
        action: "screenshot",
        engine: "cdp-motor",
        mime: "image/png",
        bytes: buf.length,
        /** callers may persist; we return prefix only in metadata-heavy logs */
        dataBase64Length: b64.length,
        dataBase64: b64.slice(0, 120) + (b64.length > 120 ? "…" : ""),
        pageUrl: tab.page?.url || null,
      };
    }

    let plan;
    if (action === "click") {
      const target = await resolveClickTarget(tab, input);
      if (!target || target.error) {
        return {
          ok: false,
          error:
            target?.error ||
            "click requires x,y or resolvable ref/name (run observe, pass ref or label)",
          code: "CUA_ACT_NEED_COORDS",
          engine: "cdp-motor",
        };
      }
      const x = target.x;
      const y = target.y;
      plan = planClick({
        x,
        y,
        button: input.button || "left",
        clickCount: input.clickCount || 1,
        label: target.label || input.ref || input.label,
      });
      plan.meta = { ...plan.meta, coordSource: target.source };
    } else if (action === "type") {
      plan = planType({ text: input.text ?? "" });
    } else if (action === "scroll") {
      plan = planScroll({
        x: Number(input.x) || 0,
        y: Number(input.y) || 0,
        deltaX: Number(input.deltaX) || 0,
        deltaY: Number(input.deltaY) || 100,
      });
    } else if (action === "key") {
      // minimal key via type plan single char or raw dispatch
      const key = String(input.key || "");
      if (!key) {
        return { ok: false, error: "key requires key string", code: "CUA_ACT_NEED_KEY" };
      }
      await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key });
      await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key });
      return {
        ok: true,
        action: "key",
        engine: "cdp-motor",
        key,
        pageUrl: tab.page?.url || null,
      };
    } else {
      return {
        ok: false,
        error: `unsupported action: ${action}`,
        code: "CUA_ACT_UNKNOWN",
      };
    }

    const result = await executeSteps(tab, plan.steps);
    return {
      ok: true,
      action,
      engine: "cdp-motor",
      executed: result.executed,
      total: result.total,
      meta: plan.meta,
      pageUrl: tab.page?.url || null,
      cuaPolicy: "tools_first_then_observe_then_gui",
    };
  } catch (e) {
    return {
      ok: false,
      error: e?.message || String(e),
      code: "CUA_ACT_EXEC_FAILED",
      engine: "cdp-motor",
    };
  } finally {
    try {
      tab?.close?.();
    } catch {
      /* ignore */
    }
  }
}

export const ComputerActTool = {
  name: "xclaw_computer_act",
  description:
    "CUA GUI actuation via CDP (click/type/key/scroll/screenshot) when XCLAW_CDP_URL is set. Prefer connectors/tools and xclaw_browser_tab observe first. Native without CDP fails closed.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "click | type | key | scroll | screenshot",
      },
      tabId: { type: "string" },
      urlMatch: { type: "string", description: "Pick CDP page by URL substring" },
      ref: { type: "string", description: "Element ref from observe (label only until ref→coords)" },
      x: { type: "number" },
      y: { type: "number" },
      text: { type: "string" },
      key: { type: "string" },
      deltaX: { type: "number" },
      deltaY: { type: "number" },
      button: { type: "string" },
      clickCount: { type: "number" },
    },
  },
  isReadOnly: () => false,
  async call(input, _ctx = {}) {
    const data = await runComputerAct(input || {});
    return { data };
  },
};

export default ComputerActTool;
