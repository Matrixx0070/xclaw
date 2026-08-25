/**
 * A3 — Operator reach / capability banner (channel-invariant).
 *
 * Honest about what this process can touch: local computer HTTP, optional
 * CDP attach to a user Chromium, profile grants. Does not invent desktop
 * access when the node is remote-only.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveComputerEngine } from "../computer/engine.mjs";

/**
 * @param {object} [cfg]
 * @param {{ computerUrl?: string|null, computerOk?: boolean|null, workingDir?: string }} [live]
 */
export function resolveReach(cfg = {}, live = {}) {
  // Engine identity comes from the canonical resolver (ADR 0006), never a raw
  // env/cfg read. ADR 0006 promises deployments carrying a retired selector
  // ("native"/"thin"/…) keep working, but this banner used to pass the
  // selector straight through — so such a node reported screenshot:false and
  // fullBrowser:false and the agent believed it had lost two capabilities the
  // bundle actually has.
  const engine = resolveComputerEngine(cfg);
  const cdpUrl =
    process.env.XCLAW_CDP_URL ||
    process.env.CDP_URL ||
    cfg.computer?.cdpUrl ||
    cfg.browser?.cdpUrl ||
    null;
  const profile =
    process.env.XCLAW_PROFILE ||
    cfg.profile ||
    cfg.security?.profile ||
    "lab";
  const host = cfg.computer?.host || "127.0.0.1";
  const port = cfg.computer?.port || 4243;
  const computerUrl =
    live.computerUrl ||
    cfg.computer?.remoteUrl ||
    `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`;

  const localFs = true; // agent process FS (sandbox may still restrict tools)
  const computerHttp = live.computerOk !== false; // optimistic unless probed false
  const cdpAttach = Boolean(cdpUrl);

  const screenshot =
    String(engine) === "bundle" || Boolean(cdpAttach);
  const browserObserve = true; // native HTML structure observe always available
  const desktopGuiOptIn =
    process.env.XCLAW_DESKTOP_GUI === "1" || process.env.XCLAW_DESKTOP_GUI === "true";
  const desktopGui = Boolean(desktopGuiOptIn); // I5 driver exists; still opt-in only
  const cuaPolicy = "tools_first_then_observe_then_gui";

  return {
    profile: String(profile),
    engine: String(engine),
    workingDir: live.workingDir || process.cwd(),
    localFs,
    computerHttp,
    computerUrl,
    cdpAttach,
    browserObserve,
    screenshot,
    desktopGui,
    desktopGuiOptIn,
    cuaPolicy,
    cdpUrl: cdpUrl || null,
    /** true when we can drive a browser beyond native fetch tabs */
    fullBrowser: cdpAttach || engine === "bundle",
    remoteOnly: Boolean(cfg.computer?.remoteUrl) && !cdpAttach,
  };
}

/**
 * One-liner users run on their machine to expose Chromium to XClaw.
 * @param {number} [port=9222]
 */
export function cdpAttachCommand(port = 9222) {
  const p = Number(port) || 9222;
  return (
    `chromium --remote-debugging-port=${p} --user-data-dir=$HOME/.xclaw/chrome-cdp ` +
    `(then: export XCLAW_CDP_URL=http://127.0.0.1:${p})`
  );
}

/**
 * System-prompt appendix — honest reach, same on every channel.
 * @param {ReturnType<typeof resolveReach>} reach
 */
export function formatCapabilityBanner(reach) {
  const lines = [
    "",
    "## Capability reach (this session)",
    `Profile: ${reach.profile} · computer engine: ${reach.engine}`,
    `Working dir: ${reach.workingDir}`,
  ];
  if (reach.localFs) {
    lines.push("- Local filesystem/tools: available via agent tools (subject to approval policy).");
  }
  if (reach.computerHttp) {
    lines.push(`- Computer service: ${reach.computerUrl} (bash/files/browser tools when healthy).`);
  } else {
    lines.push(
      "- Computer service: NOT healthy — start with computer ensure or set XCLAW_COMPUTER_ENGINE=native."
    );
  }
  if (reach.cdpAttach) {
    lines.push(`- CDP attach: ${reach.cdpUrl} — may control an existing Chromium.`);
  } else {
    lines.push(
      "- CDP attach: none — cannot see the user's desktop display or already-open windows."
    );
    lines.push(
      `- To attach local Chromium: ${cdpAttachCommand(9222)}`
    );
  }
  if (!reach.fullBrowser) {
    lines.push(
      "- Full interactive browser (CDP): limited — native engine uses fetch-based tabs unless bundle/CDP is enabled."
    );
  }
  lines.push(
    `- CUA policy: ${reach.cuaPolicy || "tools_first_then_observe_then_gui"} (APIs/tools → browser observe → CDP act → desktop last).`
  );
  lines.push(
    "- Tools: xclaw_browser_tab (observe structure) · xclaw_computer_act (click/type/key/screenshot when CDP or desktop opt-in)."
  );
  if (reach.browserObserve) {
    lines.push("- Browser observe: available (HTML structure / refs) without screenshots.");
  }
  if (reach.desktopGui) {
    lines.push("- Desktop GUI act: ENABLED (XCLAW_DESKTOP_GUI) — OS-level input allowed (lab).");
  } else {
    lines.push("- Desktop GUI act: disabled (default). Prefer CDP; opt-in only if required.");
  }
  lines.push(
    "- Be honest: never claim you can see the user's screen or GUI without CDP/computer evidence."
  );
  return lines.join("\n");
}

/**
 * Optional probe: is computer HTTP up? (best-effort, short timeout)
 * @param {string} url
 */
export async function probeComputerHttp(url, timeoutMs = 1200) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch(`${url.replace(/\/$/, "")}/health`, {
      signal: ac.signal,
    });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Env file hint for operator node (docs / doctor).
 */
export function operatorNodeEnvExample() {
  return [
    "# Operator node — run XClaw computer on the machine that has the browser/files",
    "export XCLAW_PROFILE=lab",
    "export XCLAW_COMPUTER_ENGINE=bundle   # or native",
    "export XCLAW_CDP_URL=http://127.0.0.1:9222  # optional attach",
    "# Start Chromium with: " + cdpAttachCommand(9222),
  ].join("\n");
}

export default {
  resolveReach,
  cdpAttachCommand,
  formatCapabilityBanner,
  probeComputerHttp,
  operatorNodeEnvExample,
};
