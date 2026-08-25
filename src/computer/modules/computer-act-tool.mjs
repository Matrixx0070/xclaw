/**
 * Unified computer actuation (CUA).
 *
 * Maintained source for the single bundle engine (ADR 0006): the runtime
 * loads this module through loadNativeMergeModule, and registry/browser-tab/
 * eval import it directly. Engine identity in results comes from the
 * canonical resolver, never from a raw env read — the retired selectors
 * ("native"/"thin"/…) must not leak back into operator-visible output.
 *
 * Policy: tools → observe → GUI act.
 *
 * Endpoint: XCLAW_CDP_URL / CDP_URL when the operator attached a browser,
 * otherwise the managed headless Chrome (chrome-session.mjs), spawned
 * lazily on first use. Fails typed (CUA_BROWSER_UNAVAILABLE) only when no
 * Chrome binary exists on the host.
 */

import fs from "node:fs";
import path from "node:path";
import { createCdpClient } from "../../browser/cdp-client.mjs";
import { ensureChrome, externalCdpEndpoint } from "../chrome-session.mjs";
import { SCREENSHOT_DIR } from "./browser-cdp.mjs";
import { planClick, planType, planScroll, executeSteps } from "../../browser/motor.mjs";
import { runDesktopAct, runDesktopObserve, probeDesktopDriver } from "./desktop-driver.mjs";
import { enrichCuaError, classifyCdpError } from "../cua-errors.mjs";
import { withCuaRetry } from "../cua-retry.mjs";
import { resolveComputerEngine } from "../engine.mjs";

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

/**
 * CDP endpoint: operator-attached (XCLAW_CDP_URL) wins; otherwise the
 * managed headless Chrome is ensured (spawned on first use). GUI actuation
 * works out of the box — no env var, no operator-attached browser required.
 */
async function resolveCdpEndpoint() {
  const external = externalCdpEndpoint();
  if (external) return external;
  return ensureChrome();
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
async function runComputerActImpl(input = {}) {
  const action = String(input.action || "click").toLowerCase();

  if (action === "observe") {
    return {
      ok: false,
      error:
        "Use xclaw_browser_tab with action=observe (structure). computer_act is for GUI actuation only.",
      code: "USE_BROWSER_OBSERVE",
      engine: resolveComputerEngine(),
    };
  }

  // Desktop surface — observe (AT-SPI) or act (opt-in xdotool)
  if (input.surface === "desktop" || input.desktop === true) {
    const a = String(input.action || "click").toLowerCase();
    if (a === "observe") {
      const obs = await runDesktopObserve(input);
      if (obs?.ok && obs.elements) {
        try {
          cacheObserveResult(input.tabId || "desktop", obs);
        } catch {
          /* ignore */
        }
      }
      return obs;
    }
    return runDesktopAct(input);
  }

  // Early validate navigate args (before CDP attach) for clear NEED_URL
  if (action === "navigate") {
    const url = String(input.url || input.href || "").trim();
    if (!url) {
      return {
        ok: false,
        error: "navigate requires url",
        code: "CUA_ACT_NEED_URL",
        engine: resolveComputerEngine(),
      };
    }
  }

  const engine = resolveComputerEngine();
  let cdpEp;
  try {
    cdpEp = await resolveCdpEndpoint();
  } catch (e) {
    return {
      ok: false,
      error: `no browser available for GUI actuation: ${e?.message || e}`,
      code: "CUA_BROWSER_UNAVAILABLE",
      engine,
      cuaPolicy: "tools_first_then_observe_then_gui",
      hint: "install chromium (or set XCLAW_BROWSER_BINARY / XCLAW_CDP_URL)",
    };
  }

  let client;
  let tab;
  try {
    const attachResult = await withCuaRetry(
      async () => {
        client = createCdpClient({ host: cdpEp.host, port: cdpEp.port });
        const match = input.targetId
          ? (p) => p.id === input.targetId
          : input.urlMatch || undefined;
        tab = await client.attach(match);
        return { ok: true, tab };
      },
      {
        retries: Number(process.env.XCLAW_CUA_RETRIES ?? 2),
        baseMs: Number(process.env.XCLAW_CUA_RETRY_BASE_MS ?? 120),
        maxMs: Number(process.env.XCLAW_CUA_RETRY_MAX_MS ?? 3000),
      }
    );
    tab = attachResult.tab || tab;
  } catch (e) {
    const code = classifyCdpError(e);
    return {
      ok: false,
      error: `CDP attach failed: ${e?.message || e}`,
      code,
      engine,
      cdp: cdpEp,
      retries: Number(process.env.XCLAW_CUA_RETRIES ?? 2),
    };
  }

  try {
    if (action === "navigate") {
      const url = String(input.url || input.href || "").trim();
      if (!url) {
        return {
          ok: false,
          error: "navigate requires url",
          code: "CUA_ACT_NEED_URL",
          engine: "cdp-motor",
        };
      }
      try {
        await tab.navigate(url);
        try {
          await tab.send("Page.enable");
          await new Promise((r) => setTimeout(r, Number(input.waitMs) || 400));
        } catch {
          /* ignore settle errors */
        }
        let pageUrl = null;
        try {
          pageUrl = await tab.evaluate("location.href");
        } catch {
          pageUrl = url;
        }
        return {
          ok: true,
          action: "navigate",
          engine: "cdp-motor",
          url,
          pageUrl,
          cuaPolicy: "tools_first_then_observe_then_gui",
        };
      } catch (e) {
        return {
          ok: false,
          error: e?.message || String(e),
          code: classifyCdpError(e) === "CDP_ATTACH_FAILED" ? "CDP_NAVIGATE_FAILED" : classifyCdpError(e),
          engine: "cdp-motor",
          url,
        };
      }
    }

    if (action === "screenshot") {
      const buf = await tab.screenshot();
      // Full image goes to disk (16MB of base64 does not belong in model
      // context); callers read the file when vision is actually needed.
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
      const file = path.join(SCREENSHOT_DIR, `act-${Date.now()}.png`);
      fs.writeFileSync(file, buf);
      return {
        ok: true,
        action: "screenshot",
        engine: "cdp-motor",
        mime: "image/png",
        bytes: buf.length,
        path: file,
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

    const result = await withCuaRetry(
      async () => {
        const r = await executeSteps(tab, plan.steps);
        if (r && r.ok === false) {
          return {
            ok: false,
            error: r.error || "executeSteps failed",
            code: "CUA_ACT_EXEC_FAILED",
            engine: "cdp-motor",
          };
        }
        return {
          ok: true,
          action,
          engine: "cdp-motor",
          executed: r.executed,
          total: r.total,
          meta: plan.meta,
          pageUrl: tab.page?.url || null,
          cuaPolicy: "tools_first_then_observe_then_gui",
        };
      },
      {
        retries: Number(process.env.XCLAW_CUA_RETRIES ?? 2),
        baseMs: Number(process.env.XCLAW_CUA_RETRY_BASE_MS ?? 80),
        maxMs: Number(process.env.XCLAW_CUA_RETRY_MAX_MS ?? 2000),
      }
    );
    return result;
  } catch (e) {
    const code = classifyCdpError(e);
    return {
      ok: false,
      error: e?.message || String(e),
      code: code === "CDP_ATTACH_FAILED" ? "CUA_ACT_EXEC_FAILED" : code,
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
    "CUA GUI actuation via CDP (navigate/click/type/key/scroll/screenshot) on the managed headless Chrome (or XCLAW_CDP_URL when attached). Prefer connectors/tools and xclaw_browser_tab observe first. Screenshots are written to disk as full PNG.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "navigate | click | type | key | scroll | screenshot",
      },
      tabId: { type: "string" },
      targetId: { type: "string", description: "Exact CDP target id to act on" },
      url: { type: "string", description: "Target URL for action=navigate" },
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


/** @param {Parameters<typeof runComputerActImpl>[0]} input */
export async function runComputerAct(input) {
  const r = await runComputerActImpl(input);
  return enrichCuaError(r);
}
