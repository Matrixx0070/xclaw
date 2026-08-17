/**
 * CUA / computer-use doctor — CDP + desktop observe/act readiness.
 * Fail-closed honesty: never claims GUI works without probes.
 */
import os from "node:os";
import http from "node:http";
import { probeDesktopDriver, whichDesktopTools, runDesktopObserve } from "./modules/desktop-driver.mjs";
import { resolveReach } from "../agent/capability-reach.mjs";
import { lookupCuaError, CUA_ERROR_CATALOG } from "./cua-errors.mjs";
import { getCuaRetryMetrics } from "./cua-retry-metrics.mjs";

function httpGet(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const req = http.get(
        { host: u.hostname, port: u.port || 80, path: u.pathname, timeout: timeoutMs },
        (res) => {
          let d = "";
          res.on("data", (c) => (d += c));
          res.on("end", () => resolve({ ok: res.statusCode === 200, status: res.statusCode, body: d }));
        }
      );
      req.on("error", (e) => resolve({ ok: false, error: e.message }));
      req.on("timeout", () => {
        req.destroy();
        resolve({ ok: false, error: "timeout" });
      });
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

/**
 * @returns {Promise<{ checks: object[], summary: object, ok: boolean, warnings: number, errors: number }>}
 */
export async function runCuaDoctor(env = process.env) {
  const checks = [];
  const push = (id, ok, severity, message, hint = null, extra = {}) => {
    checks.push({ id, ok, severity, message, hint, ...extra });
  };

  const platform = os.platform();
  const cdpUrl = env.XCLAW_CDP_URL || env.CDP_URL || null;
  const desktopOn = env.XCLAW_DESKTOP_GUI === "1" || env.XCLAW_DESKTOP_GUI === "true";
  const probe = probeDesktopDriver(env);
  let reach = {};
  try {
    reach = resolveReach({ env }) || resolveReach({}) || {};
  } catch {
    reach = {};
  }

  // Policy
  push(
    "cua_policy",
    true,
    "ok",
    `policy=${reach.cuaPolicy || probe.cuaOrder || "tools_first_then_observe_then_gui"}`,
    "Prefer APIs/tools → browser observe → CDP act → desktop GUI last"
  );

  // CDP
  if (!cdpUrl) {
    push(
      "cdp",
      true,
      "warn",
      "XCLAW_CDP_URL not set — computer_act click/type/screenshot fail closed",
      "Start Chrome: google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/xclaw-cdp about:blank\nexport XCLAW_CDP_URL=http://127.0.0.1:9222\nThen: node scripts/cdp-live-smoke.mjs"
    );
  } else {
    const ver = await httpGet(new URL("/json/version", cdpUrl).href);
    if (ver.ok) {
      let browser = "cdp";
      try {
        browser = JSON.parse(ver.body).Browser || browser;
      } catch {
        /* ignore */
      }
      push("cdp", true, "ok", `reachable · ${browser}`, null, { endpoint: cdpUrl });
    } else {
      push(
        "cdp",
        false,
        "error",
        `XCLAW_CDP_URL set but not reachable: ${ver.error || ver.status}`,
        "Check Chrome is running with --remote-debugging-port matching the URL",
        { endpoint: cdpUrl }
      );
    }
  }

  // Desktop opt-in
  push(
    "desktop_opt_in",
    true,
    desktopOn ? "warn" : "ok",
    desktopOn
      ? "XCLAW_DESKTOP_GUI=1 (lab only — OS input injection enabled)"
      : "desktop GUI act disabled (default fail-closed)",
    desktopOn
      ? "Unset XCLAW_DESKTOP_GUI unless you need OS-level click/type outside the browser"
      : "export XCLAW_DESKTOP_GUI=1 only in lab when you need native OS GUI"
  );

  // Platform backends
  if (platform === "linux") {
    const tools = await whichDesktopTools();
    const hasTool = !!(tools.xdotool || tools.ydotool);
    push(
      "desktop_linux_act",
      true,
      hasTool ? "ok" : "warn",
      hasTool
        ? `act backend: ${tools.xdotool ? "xdotool" : "ydotool"}`
        : "no xdotool/ydotool on PATH",
      hasTool ? null : "sudo apt install xdotool   # or ydotool for Wayland"
    );
    const obs = await runDesktopObserve({ max: 3 }, env);
    push(
      "desktop_linux_observe",
      true,
      obs.ok ? "ok" : "warn",
      obs.ok
        ? `AT-SPI observe ok · elements=${obs.elementCount}`
        : `AT-SPI: ${obs.code || obs.error}`,
      obs.ok
        ? null
        : "sudo apt install python3-pyatspi  # or gir1.2-atspi-2.0 + pyatspi"
    );
  } else if (platform === "win32") {
    push(
      "desktop_windows",
      true,
      "info",
      "Windows UIA helpers: scripts/desktop-uia-observe.py + desktop-uia-act.py",
      "pip install pywinauto\n# Observe needs no opt-in; act needs XCLAW_DESKTOP_GUI=1"
    );
  } else if (platform === "darwin") {
    push(
      "desktop_macos",
      true,
      "info",
      "macOS AX helpers: scripts/desktop-ax-observe.py + desktop-ax-act.py",
      "pip install pyobjc-framework-ApplicationServices pyobjc-framework-Quartz pyobjc-framework-Cocoa\nSystem Settings → Privacy & Security → Accessibility (allow Terminal/node)\nAct needs XCLAW_DESKTOP_GUI=1"
    );
  } else {
    push("desktop_platform", true, "warn", `unsupported platform: ${platform}`);
  }

  // Reach flags
  const rm = getCuaRetryMetrics();
  push(
    "cua_retry_metrics",
    true,
    rm.retries > 20 ? "warn" : "ok",
    `attempts=${rm.attempts} retries=${rm.retries} successRate=${rm.successRate ?? "n/a"} avgDelayMs=${rm.avgDelayMs}`,
    rm.retries > 0
      ? `JSONL: ${rm.jsonlPath} · top codes: ${Object.keys(rm.byCode).slice(0, 5).join(",") || "—"}`
      : "No retries yet in this process"
  );

  push(
    "reach_flags",
    true,
    "ok",
    `browserObserve=${reach.browserObserve !== false} desktopGui=${!!reach.desktopGui || desktopOn}`,
    null
  );

  const errors = checks.filter((c) => c.severity === "error").length;
  const warnings = checks.filter((c) => c.severity === "warn").length;
  return {
    suite: "cua-doctor",
    platform,
    at: new Date().toISOString(),
    checks,
    summary: {
      cdpConfigured: !!cdpUrl,
      desktopGui: desktopOn,
      errors,
      warnings,
    },
    errorCatalogSize: Object.keys(CUA_ERROR_CATALOG).length,
    retryMetrics: getCuaRetryMetrics(),
    ok: errors === 0,
    warnings,
    errors,
  };
}

/** Resolve recovery text for a CUA code (CLI / agents). */
export function explainCuaCode(code) {
  const e = lookupCuaError(code);
  if (!e) return { code, known: false, recovery: null };
  return { code, known: true, ...e };
}


export default { runCuaDoctor };
