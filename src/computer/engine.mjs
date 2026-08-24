/**
 * Computer engine — SINGLE native engine (unification, ADR 0005, 2026-08-24).
 *
 * The vendored 16MB CDP bundle (xclaw-server.mjs) was retired after the
 * native engine reached full real-browser parity: managed headless Chrome
 * (chrome-session.mjs) + CDP tab layer (modules/browser-cdp.mjs) now cover
 * jsCode, full screenshots with device emulation, console logs, and
 * multi-request network capture. The last published bundle stays archived
 * as GitHub release `computer-bundle` (sha256 9d95d067…) for forensics.
 *
 * Legacy selectors ("bundle"/"full"/"xclaw-server"/"generated"/"gen"/"c3",
 * XCLAW_COMPUTER_NATIVE=0) all resolve to native with a one-time notice so
 * existing deployments keep working unchanged.
 */
import path from "node:path";
import fs from "node:fs";

export const DEFAULT_COMPUTER_ENGINE = "native";

const LEGACY_SELECTORS = new Set(["0", "false", "bundle", "full", "xclaw-server"]);
let warnedLegacy = false;

/**
 * @param {object} [cfg]
 * @returns {"native"}
 */
export function resolveComputerEngine(cfg = {}) {
  const sel =
    process.env.XCLAW_COMPUTER_ENGINE ||
    process.env.XCLAW_COMPUTER_NATIVE ||
    cfg.computer?.engine ||
    (cfg.computer?.nativeServer === false ? "bundle" : null);
  if (sel && LEGACY_SELECTORS.has(String(sel)) && !warnedLegacy) {
    warnedLegacy = true;
    console.error(
      `[xclaw] computer engine "${sel}" is retired — the native engine now includes the full real-browser (CDP) capability; running native. Archived bundle: GitHub release computer-bundle.`
    );
  }
  return "native";
}

export function isNativeComputer() {
  return true;
}

/**
 * @param {object} [_cfg]
 * @param {string} [root]
 */
export function resolveComputerEntryPath(_cfg = {}, root = process.cwd()) {
  return path.join(root, "src/computer/thin-server.mjs");
}

/**
 * Observability snapshot for status/doctor/logs.
 * @param {object} [cfg]
 * @param {string} [root]
 */
export function describeComputerEngine(cfg = {}, root = process.cwd()) {
  const entry = resolveComputerEntryPath(cfg, root);
  let entryExists = false;
  let entryBytes = null;
  try {
    if (fs.existsSync(entry)) {
      entryExists = true;
      entryBytes = fs.statSync(entry).size;
    }
  } catch {
    /* */
  }
  return {
    engine: resolveComputerEngine(cfg),
    entry,
    entryExists,
    entryBytes,
    strategyPhase: "unified-native",
    policy: {
      defaultEngine: DEFAULT_COMPUTER_ENGINE,
      singleEngine: true,
    },
  };
}

/** Test helper — re-arm the one-time legacy-selector notice. */
export function _resetLegacyWarnForTests() {
  warnedLegacy = false;
}

export default {
  resolveComputerEngine,
  isNativeComputer,
  resolveComputerEntryPath,
  describeComputerEngine,
  DEFAULT_COMPUTER_ENGINE,
};
