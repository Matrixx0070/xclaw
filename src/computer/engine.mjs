/**
 * Computer engine — SINGLE engine: the full CDP bundle (ADR 0006, 2026-08-24).
 *
 * Operator direction (reversing ADR 0005's native-survives shape): the
 * vendored runtime `xclaw-server.mjs` IS the one computer server, now
 * tracked in git and carrying the thin server's functions via the A6
 * merge patch (bwrap-sandboxed bash, per-call cwd, systemRunPlan assert,
 * xclaw_computer_act) bridged from the maintained native source tree.
 *
 * The thin server (thin-server.mjs) is retired. Legacy selectors
 * ("native"/"thin"/"generated"/"gen"/"c3", XCLAW_COMPUTER_NATIVE=1) all
 * resolve to the bundle with a one-time notice so existing deployments
 * keep working unchanged.
 */
import path from "node:path";
import fs from "node:fs";

export const DEFAULT_COMPUTER_ENGINE = "bundle";

const LEGACY_SELECTORS = new Set(["1", "true", "native", "thin", "generated", "gen", "c3"]);
let warnedLegacy = false;

/**
 * @param {object} [cfg]
 * @returns {"bundle"}
 */
export function resolveComputerEngine(cfg = {}) {
  const sel =
    process.env.XCLAW_COMPUTER_ENGINE ||
    process.env.XCLAW_COMPUTER_NATIVE ||
    cfg.computer?.engine ||
    (cfg.computer?.nativeServer === true ? "native" : null);
  if (sel && LEGACY_SELECTORS.has(String(sel)) && !warnedLegacy) {
    warnedLegacy = true;
    console.error(
      `[xclaw] computer engine "${sel}" is retired — the unified bundle engine (xclaw-server.mjs, A6 thin-server merge) is the single computer server; running bundle.`
    );
  }
  return "bundle";
}

export function isNativeComputer() {
  return false;
}

/**
 * @param {object} [_cfg]
 * @param {string} [root]
 */
export function resolveComputerEntryPath(_cfg = {}, root = process.cwd()) {
  return path.join(root, "src/computer/xclaw-server.mjs");
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
    strategyPhase: "unified-bundle",
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
