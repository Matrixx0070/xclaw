/**
 * I5 — DesktopDriver (OS GUI outside the browser).
 *
 * Integrates with the computer plane; does NOT replace browser CDP path.
 * Default: fail closed. Opt-in via XCLAW_DESKTOP_GUI=1.
 *
 * Linux: xdotool / ydotool when installed
 * Windows / macOS: stubs until native bindings land
 *
 * Policy: tools → browser observe/act → desktop GUI (last resort)
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";

const execFileAsync = promisify(execFile);

/**
 * @returns {{ platform: string, enabled: boolean, backend: string|null, tools: object }}
 */
export function probeDesktopDriver(env = process.env) {
  const platform = os.platform(); // linux | win32 | darwin
  const enabled = env.XCLAW_DESKTOP_GUI === "1" || env.XCLAW_DESKTOP_GUI === "true";
  const forced = env.XCLAW_DESKTOP_BACKEND || null;
  return {
    platform,
    enabled,
    backend: forced,
    tools: {
      xdotool: null, // filled async by whichDesktopTools
      ydotool: null,
    },
    cuaOrder: "tools_first_then_browser_then_desktop",
  };
}

async function which(cmd) {
  try {
    const { stdout } = await execFileAsync("which", [cmd], { timeout: 2000 });
    const p = String(stdout || "").trim();
    return p || null;
  } catch {
    return null;
  }
}

export async function whichDesktopTools() {
  if (os.platform() !== "linux") {
    return { xdotool: null, ydotool: null };
  }
  const [xdotool, ydotool] = await Promise.all([which("xdotool"), which("ydotool")]);
  return { xdotool, ydotool };
}

/**
 * @param {object} input
 * @param {string} [input.action] click|type|key|mousemove
 * @param {number} [input.x]
 * @param {number} [input.y]
 * @param {string} [input.text]
 * @param {string} [input.key]
 */
export async function runDesktopAct(input = {}, env = process.env) {
  const probe = probeDesktopDriver(env);
  if (!probe.enabled) {
    return {
      ok: false,
      error:
        "Desktop GUI disabled. Browser CDP (XCLAW_CDP_URL) is preferred. Opt-in: XCLAW_DESKTOP_GUI=1 (lab only).",
      code: "DESKTOP_GUI_DISABLED",
      platform: probe.platform,
      cuaPolicy: probe.cuaOrder,
    };
  }

  const tools = await whichDesktopTools();
  const backend =
    probe.backend ||
    (tools.xdotool ? "xdotool" : tools.ydotool ? "ydotool" : null);

  if (probe.platform !== "linux") {
    return {
      ok: false,
      error: `DesktopDriver not implemented for ${probe.platform} yet (Windows UIA / macOS AXAPI planned). Use browser CDP for GUI.`,
      code: "DESKTOP_GUI_UNSUPPORTED_OS",
      platform: probe.platform,
    };
  }

  if (!backend) {
    return {
      ok: false,
      error: "No xdotool/ydotool on PATH. Install xdotool or set XCLAW_CDP_URL for browser GUI.",
      code: "DESKTOP_GUI_NO_BACKEND",
      platform: "linux",
      tools,
    };
  }

  const action = String(input.action || "click").toLowerCase();
  const bin = backend === "ydotool" ? tools.ydotool : tools.xdotool;

  try {
    if (action === "click") {
      const x = Number(input.x);
      const y = Number(input.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { ok: false, error: "desktop click requires x,y", code: "DESKTOP_NEED_COORDS" };
      }
      if (backend === "xdotool") {
        await execFileAsync(bin, ["mousemove", String(Math.round(x)), String(Math.round(y)), "click", "1"], {
          timeout: 5000,
        });
      } else {
        // ydotool: mousemove absolute then click
        await execFileAsync(bin, ["mousemove", "--absolute", "-x", String(Math.round(x)), "-y", String(Math.round(y))], {
          timeout: 5000,
        });
        await execFileAsync(bin, ["click", "0xC0"], { timeout: 3000 });
      }
      return { ok: true, action: "click", backend, x, y, engine: "desktop-driver" };
    }

    if (action === "type") {
      const text = String(input.text ?? "");
      if (backend === "xdotool") {
        await execFileAsync(bin, ["type", "--", text], { timeout: 15000 });
      } else {
        await execFileAsync(bin, ["type", text], { timeout: 15000 });
      }
      return { ok: true, action: "type", backend, engine: "desktop-driver" };
    }

    if (action === "key") {
      const key = String(input.key || "");
      if (!key) return { ok: false, error: "key required", code: "DESKTOP_NEED_KEY" };
      if (backend === "xdotool") {
        await execFileAsync(bin, ["key", key], { timeout: 5000 });
      } else {
        await execFileAsync(bin, ["key", key], { timeout: 5000 });
      }
      return { ok: true, action: "key", key, backend, engine: "desktop-driver" };
    }

    return {
      ok: false,
      error: `unsupported desktop action: ${action}`,
      code: "DESKTOP_ACT_UNKNOWN",
    };
  } catch (e) {
    return {
      ok: false,
      error: e?.message || String(e),
      code: "DESKTOP_ACT_FAILED",
      backend,
    };
  }
}

export default {
  probeDesktopDriver,
  whichDesktopTools,
  runDesktopAct,
};
