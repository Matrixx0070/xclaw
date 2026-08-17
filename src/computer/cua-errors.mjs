/**
 * Canonical CUA error codes → recovery hints.
 * Keep messages stable; agents and doctor rely on `code`.
 */

/** @type {Record<string, { severity: string, recovery: string, surface?: string }>} */
export const CUA_ERROR_CATALOG = {
  // computer_act / CDP
  USE_BROWSER_OBSERVE: {
    severity: "info",
    surface: "browser",
    recovery:
      "Call xclaw_browser_tab with action=observe for structure. computer_act is for GUI actuation only.",
  },
  CUA_ACT_REQUIRES_BUNDLE: {
    severity: "error",
    surface: "cdp",
    recovery:
      "Set XCLAW_CDP_URL to a Chrome remote-debugging endpoint (e.g. http://127.0.0.1:9222). Prefer tools/APIs first.",
  },
  CUA_ACT_NOT_EXTRACTED: {
    severity: "error",
    surface: "bundle",
    recovery:
      "engine=bundle without CDP: attach XCLAW_CDP_URL for CLEAN motor path, or extract BrowserService modules.",
  },
  CDP_ATTACH_FAILED: {
    severity: "error",
    surface: "cdp",
    recovery:
      "CDP URL set but attach failed. Ensure Chrome is running with --remote-debugging-port and the port matches. Try: curl $XCLAW_CDP_URL/json/version",
  },
  CDP_NO_PAGE: {
    severity: "error",
    surface: "cdp",
    recovery:
      "No page target under CDP. Open a tab in the debugged Chrome or use action=navigate / client.newPage.",
  },
  CDP_NOT_LOOPBACK: {
    severity: "error",
    surface: "cdp",
    recovery:
      "CDP host is not loopback. Use 127.0.0.1 or set allowRemote only in trusted networks.",
  },
  CDP_SOCKET_CLOSED: {
    severity: "error",
    surface: "cdp",
    recovery:
      "CDP WebSocket closed mid-command. Chrome may have exited; restart debug browser and retry.",
  },
  CDP_TIMEOUT: {
    severity: "error",
    surface: "cdp",
    recovery:
      "CDP HTTP/WS timeout. Check Chrome is responsive; increase load; retry with XCLAW_CUA_RETRIES.",
  },
  CDP_HTTP_FAILED: {
    severity: "error",
    surface: "cdp",
    recovery:
      "CDP HTTP /json/* failed. Verify XCLAW_CDP_URL and curl $XCLAW_CDP_URL/json/version.",
  },
  CDP_WS_FAILED: {
    severity: "error",
    surface: "cdp",
    recovery:
      "CDP WebSocket upgrade/connect failed. Port may be HTTP-only or blocked; confirm webSocketDebuggerUrl.",
  },
  CDP_EVAL_FAILED: {
    severity: "error",
    surface: "cdp",
    recovery:
      "Runtime.evaluate threw in page. Re-observe DOM; selector/ref may be stale.",
  },
  CDP_NAVIGATE_FAILED: {
    severity: "error",
    surface: "cdp",
    recovery:
      "Page.navigate failed. Check URL scheme (http/https), network, and that the tab still exists.",
  },
  CDP_SCREENSHOT_FAILED: {
    severity: "error",
    surface: "cdp",
    recovery:
      "Page.captureScreenshot failed. Page may be crashed or target detached; re-attach and retry.",
  },
  CDP_INPUT_FAILED: {
    severity: "error",
    surface: "cdp",
    recovery:
      "Input.dispatch* failed. Page may not be focused or target closed; navigate/observe then retry.",
  },

  CUA_ACT_NEED_COORDS: {
    severity: "error",
    surface: "cdp",
    recovery: "Provide x,y or a valid observe ref (eN) with tabId after observe.",
  },
  CUA_ACT_NEED_URL: {
    severity: "error",
    surface: "cdp",
    recovery: "Pass url (https://…) for action=navigate.",
  },
  CUA_ACT_NEED_KEY: {
    severity: "error",
    surface: "cdp",
    recovery: "Pass key string (e.g. Enter, Tab, Control+s).",
  },
  CUA_ACT_UNKNOWN: {
    severity: "error",
    surface: "cdp",
    recovery: "Supported actions: navigate, click, type, key, scroll, screenshot (observe via browser_tab).",
  },
  CUA_ACT_EXEC_FAILED: {
    severity: "error",
    surface: "cdp",
    recovery: "Motor/CDP command failed mid-execution. Check page still open; retry once; re-observe if DOM changed.",
  },

  // Desktop common
  DESKTOP_GUI_DISABLED: {
    severity: "warn",
    surface: "desktop",
    recovery:
      "Default fail-closed. Lab only: export XCLAW_DESKTOP_GUI=1. Prefer XCLAW_CDP_URL for browser UIs.",
  },
  DESKTOP_GUI_UNSUPPORTED_OS: {
    severity: "error",
    surface: "desktop",
    recovery: "This OS path is not available here. Use browser CDP or run on a supported host OS.",
  },
  DESKTOP_GUI_NO_BACKEND: {
    severity: "error",
    surface: "desktop",
    recovery: "Install xdotool (Linux) or ydotool (Wayland). Windows/mac use pywinauto/pyobjc helpers.",
  },
  DESKTOP_OBSERVE_UNSUPPORTED_OS: {
    severity: "error",
    surface: "desktop",
    recovery: "Observe helper is OS-specific. Use the matching platform helper or browser observe.",
  },
  DESKTOP_NEED_COORDS: {
    severity: "error",
    surface: "desktop",
    recovery: "desktop click requires numeric x,y (or invoke with name after observe).",
  },
  DESKTOP_NEED_KEY: {
    severity: "error",
    surface: "desktop",
    recovery: "Pass key (e.g. enter, cmd+s).",
  },
  DESKTOP_NEED_NAME: {
    severity: "error",
    surface: "desktop",
    recovery: "invoke requires name (and optional title/app) matching an accessibility node.",
  },
  DESKTOP_NEED_TEXT: {
    severity: "error",
    surface: "desktop",
    recovery: "type requires text string.",
  },
  DESKTOP_ACT_UNKNOWN: {
    severity: "error",
    surface: "desktop",
    recovery: "Supported: click, type, key, invoke (platform-dependent).",
  },
  DESKTOP_ACT_FAILED: {
    severity: "error",
    surface: "desktop",
    recovery: "OS input injection failed. Check backend binary, display server, and permissions.",
  },

  // AT-SPI
  ATSPI_NOT_INSTALLED: {
    severity: "warn",
    surface: "desktop-linux",
    recovery: "sudo apt install python3-pyatspi   # or gir1.2-atspi-2.0",
  },
  ATSPI_REGISTRY_FAILED: {
    severity: "error",
    surface: "desktop-linux",
    recovery: "AT-SPI registry unavailable. Is a desktop session running? Check accessibility bus.",
  },
  ATSPI_WALK_FAILED: {
    severity: "error",
    surface: "desktop-linux",
    recovery: "Tree walk failed. Retry; filter with app=; check app exposes AT-SPI.",
  },
  ATSPI_EMPTY: {
    severity: "warn",
    surface: "desktop-linux",
    recovery: "Helper returned empty stdout. Reinstall helper script / python3.",
  },
  ATSPI_HELPER_MISSING: {
    severity: "error",
    surface: "desktop-linux",
    recovery: "scripts/desktop-atspi-observe.py or python3 missing from install.",
  },
  ATSPI_EXEC_FAILED: {
    severity: "error",
    surface: "desktop-linux",
    recovery: "Failed to exec AT-SPI helper. Check python3 and script permissions.",
  },
  ATSPI_BAD_JSON: {
    severity: "error",
    surface: "desktop-linux",
    recovery: "Helper emitted non-JSON. See raw field; fix script version mismatch.",
  },

  // UIA
  UIA_NOT_INSTALLED: {
    severity: "warn",
    surface: "desktop-windows",
    recovery: "pip install pywinauto",
  },
  UIA_DESKTOP_FAILED: {
    severity: "error",
    surface: "desktop-windows",
    recovery: "Could not open UIA Desktop(). Run in an interactive Windows session.",
  },
  UIA_WALK_FAILED: {
    severity: "error",
    surface: "desktop-windows",
    recovery: "UIA tree walk failed. Try app= filter; run elevated only if target requires it.",
  },
  UIA_WINDOW_NOT_FOUND: {
    severity: "error",
    surface: "desktop-windows",
    recovery: "No window matched title=. List windows via observe first.",
  },
  UIA_ELEMENT_NOT_FOUND: {
    severity: "error",
    surface: "desktop-windows",
    recovery: "No element matched name=. Re-observe; names must match UIA Name.",
  },
  UIA_INVOKE_FAILED: {
    severity: "error",
    surface: "desktop-windows",
    recovery: "Invoke/click_input failed. Element may not support InvokePattern; try coords click.",
  },
  UIA_ACT_FAILED: {
    severity: "error",
    surface: "desktop-windows",
    recovery: "pywinauto act failed. Check focus, UIPI integrity, and that GUI is not minimized oddly.",
  },
  UIA_HELPER_MISSING: {
    severity: "error",
    surface: "desktop-windows",
    recovery: "scripts/desktop-uia-*.py or python3 missing.",
  },
  UIA_EXEC_FAILED: {
    severity: "error",
    surface: "desktop-windows",
    recovery: "Failed to exec UIA helper.",
  },
  UIA_BAD_JSON: {
    severity: "error",
    surface: "desktop-windows",
    recovery: "UIA helper returned invalid JSON.",
  },
  UIA_EMPTY: {
    severity: "warn",
    surface: "desktop-windows",
    recovery: "Empty helper stdout.",
  },

  // AX
  AX_NOT_INSTALLED: {
    severity: "warn",
    surface: "desktop-macos",
    recovery:
      "pip install pyobjc-framework-ApplicationServices pyobjc-framework-Quartz pyobjc-framework-Cocoa",
  },
  AX_TCC_REQUIRED: {
    severity: "error",
    surface: "desktop-macos",
    recovery:
      "System Settings → Privacy & Security → Accessibility — allow Terminal/node (or the XClaw app).",
  },
  AX_WALK_FAILED: {
    severity: "error",
    surface: "desktop-macos",
    recovery: "AX tree walk failed. Grant Accessibility; retry with app= filter.",
  },
  AX_ELEMENT_NOT_FOUND: {
    severity: "error",
    surface: "desktop-macos",
    recovery: "No AX element matched name=. Re-observe; titles must match AXTitle.",
  },
  AX_INVOKE_FAILED: {
    severity: "error",
    surface: "desktop-macos",
    recovery: "AXPress and CGEvent fallback both failed. Check TCC and element visibility.",
  },
  AX_ACT_FAILED: {
    severity: "error",
    surface: "desktop-macos",
    recovery: "CGEvent/AX act failed. Accessibility must be granted to the host process.",
  },
  AX_HELPER_MISSING: {
    severity: "error",
    surface: "desktop-macos",
    recovery: "scripts/desktop-ax-*.py or python3 missing.",
  },
  AX_EXEC_FAILED: {
    severity: "error",
    surface: "desktop-macos",
    recovery: "Failed to exec AX helper.",
  },
  AX_BAD_JSON: {
    severity: "error",
    surface: "desktop-macos",
    recovery: "AX helper returned invalid JSON.",
  },
  AX_EMPTY: {
    severity: "warn",
    surface: "desktop-macos",
    recovery: "Empty helper stdout.",
  },
};

/**
 * Enrich a CUA failure object with catalog recovery (non-destructive).
 * @param {{ ok?: boolean, code?: string, error?: string, hint?: string }} result
 */
export function enrichCuaError(result) {
  if (!result || result.ok === true || !result.code) return result;
  const entry = CUA_ERROR_CATALOG[result.code];
  if (!entry) return result;
  return {
    ...result,
    severity: result.severity || entry.severity,
    surface: result.surface || entry.surface,
    recovery: result.recovery || entry.recovery,
    hint: result.hint || entry.recovery,
  };
}

/** Lookup only */
export function lookupCuaError(code) {
  return CUA_ERROR_CATALOG[code] || null;
}


/**
 * Map CDP/client Error messages → stable CUA codes.
 * @param {unknown} err
 * @returns {string}
 */
export function classifyCdpError(err) {
  const msg = String(err?.message || err || "");
  if (/not loopback|allowRemote/i.test(msg)) return "CDP_NOT_LOOPBACK";
  if (/no CDP page target|no page target/i.test(msg)) return "CDP_NO_PAGE";
  if (/socket closed|WebSocket.*close/i.test(msg)) return "CDP_SOCKET_CLOSED";
  if (/timeout|ETIMEDOUT/i.test(msg)) return "CDP_TIMEOUT";
  if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH/i.test(msg)) return "CDP_ATTACH_FAILED";
  if (/\/json\/|invalid JSON|CDP HTTP/i.test(msg)) return "CDP_HTTP_FAILED";
  if (/WS timeout|upgrade|websocket/i.test(msg)) return "CDP_WS_FAILED";
  if (/evaluate failed|exceptionDetails/i.test(msg)) return "CDP_EVAL_FAILED";
  if (/Page\.navigate|navigate failed/i.test(msg)) return "CDP_NAVIGATE_FAILED";
  if (/captureScreenshot|screenshot/i.test(msg)) return "CDP_SCREENSHOT_FAILED";
  if (/Input\.dispatch/i.test(msg)) return "CDP_INPUT_FAILED";
  if (/CDP attach/i.test(msg)) return "CDP_ATTACH_FAILED";
  return "CDP_ATTACH_FAILED";
}

export default { CUA_ERROR_CATALOG, enrichCuaError, lookupCuaError, classifyCdpError };
