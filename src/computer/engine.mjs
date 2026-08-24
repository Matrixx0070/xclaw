/**
 * Computer engine selection — native-default (30-day plan W4).
 *
 * - native / thin: thin-server.mjs (auditable modules + bwrap sandbox) — DEFAULT
 * - bundle: xclaw-server.mjs (~16MB CDP runtime; do not hand-edit) — opt-in
 *
 * Override: XCLAW_COMPUTER_ENGINE=native|bundle
 *
 * The "generated" engine (esbuild re-bundle of the native modules) was
 * deleted 2026-08-23 (S4, Master Evolution Directive): it was a byte-for-byte
 * duplicate of what native runs directly, reachable only by explicit opt-in,
 * and its emit step dirtied the tree on every test run. Stale
 * "generated"/"gen"/"c3" selectors resolve to native (same code, unbundled).
 */
import path from "node:path";
import fs from "node:fs";

/** Product default when no env/cfg override is set.
 * 30-day plan W4 (2026-08-24): default flipped bundle → NATIVE. The native
 * plane is auditable source (src/computer/modules/*) and runs bash through
 * the bwrap OS sandbox (wrapSpawnWithOsSandbox); the 395k-line vendored CDP
 * bundle remains fully selectable (cfg.computer.engine:"bundle" /
 * XCLAW_COMPUTER_ENGINE=bundle) for CUA browser capability. Existing
 * deployments that relied on the old default should pin engine:"bundle"
 * (the live lab box is pinned; see xclaw.json). */
export const DEFAULT_COMPUTER_ENGINE = "native";

/**
 * @param {object} [cfg]
 * @returns {"native" | "bundle"}
 */
export function resolveComputerEngine(cfg = {}) {
  const env = process.env.XCLAW_COMPUTER_ENGINE || process.env.XCLAW_COMPUTER_NATIVE;
  // Explicit native/thin request (env "1"/true historically meant native server on)
  if (env === "1" || env === "true" || env === "native" || env === "thin") return "native";
  // Legacy generated selectors → native (the generated engine WAS the native
  // modules, esbuilt; native is the same behavior without the build step).
  if (env === "generated" || env === "gen" || env === "c3") return "native";
  if (env === "0" || env === "false" || env === "bundle" || env === "full") return "bundle";

  const eng = cfg.computer?.engine;
  if (eng === "native" || eng === "thin") return "native";
  if (eng === "generated" || eng === "gen") return "native";
  if (eng === "bundle" || eng === "full" || eng === "xclaw-server") return "bundle";

  // Legacy: nativeServer true forces thin escape hatch
  if (cfg.computer?.nativeServer === true) return "native";
  if (cfg.computer?.nativeServer === false) return "bundle";

  return DEFAULT_COMPUTER_ENGINE;
}

export function isNativeComputer(cfg = {}) {
  return resolveComputerEngine(cfg) === "native";
}

/**
 * @param {object} [cfg]
 * @param {string} [root]
 */
export function resolveComputerEntryPath(cfg = {}, root = process.cwd()) {
  const eng = resolveComputerEngine(cfg);
  if (eng === "bundle") {
    if (cfg.computer?.entry) {
      return path.isAbsolute(cfg.computer.entry)
        ? cfg.computer.entry
        : path.join(root, cfg.computer.entry);
    }
    return path.join(root, "src/computer/xclaw-server.mjs");
  }
  return path.join(root, "src/computer/thin-server.mjs");
}

/**
 * Observability snapshot for status/doctor/logs (C4).
 * @param {object} [cfg]
 * @param {string} [root]
 */
export function describeComputerEngine(cfg = {}, root = process.cwd()) {
  const engine = resolveComputerEngine(cfg);
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
    engine,
    entry,
    entryExists,
    entryBytes,
    /** @deprecated bundle is default; true only if somehow treated as non-default */
    isFallbackBundle: engine === "bundle" && DEFAULT_COMPUTER_ENGINE !== "bundle",
    isDefaultBundle: engine === "bundle",
    strategyPhase: engine === "native" ? "C5-native" : "C4",
    policy: {
      defaultEngine: DEFAULT_COMPUTER_ENGINE,
      handEditBundle: false,
      lightweightEscape: "native",
    },
  };
}

export default {
  resolveComputerEngine,
  isNativeComputer,
  resolveComputerEntryPath,
  describeComputerEngine,
  DEFAULT_COMPUTER_ENGINE,
};
