/**
 * Computer engine selection — Bundle-default (D1).
 *
 * - bundle: xclaw-server.mjs (~16MB CDP runtime; do not hand-edit) — DEFAULT
 * - native / thin: thin-server.mjs (lightweight escape hatch)
 * - generated: generated/computer-server.mjs (esbuild from modules) — C3
 *
 * Override: XCLAW_COMPUTER_ENGINE=native|generated|bundle
 * Build modules: npm run build:computer
 * Parity gate: npm run check:computer-parity (escape-hatch native still tracked)
 */
import path from "node:path";
import fs from "node:fs";

/** Product default when no env/cfg override is set. */
export const DEFAULT_COMPUTER_ENGINE = "bundle";

/**
 * @param {object} [cfg]
 * @returns {"native" | "generated" | "bundle"}
 */
export function resolveComputerEngine(cfg = {}) {
  const env = process.env.XCLAW_COMPUTER_ENGINE || process.env.XCLAW_COMPUTER_NATIVE;
  // Explicit native/thin request (env "1"/true historically meant native server on)
  if (env === "1" || env === "true" || env === "native" || env === "thin") return "native";
  if (env === "generated" || env === "gen" || env === "c3") return "generated";
  if (env === "0" || env === "false" || env === "bundle" || env === "full") return "bundle";

  const eng = cfg.computer?.engine;
  if (eng === "native" || eng === "thin") return "native";
  if (eng === "generated" || eng === "gen") return "generated";
  if (eng === "bundle" || eng === "full" || eng === "xclaw-server") return "bundle";

  // Legacy: nativeServer true forces thin escape hatch
  if (cfg.computer?.nativeServer === true) return "native";
  if (cfg.computer?.nativeServer === false) return "bundle";

  return DEFAULT_COMPUTER_ENGINE;
}

export function isNativeComputer(cfg = {}) {
  return resolveComputerEngine(cfg) === "native";
}

export function isGeneratedComputer(cfg = {}) {
  return resolveComputerEngine(cfg) === "generated";
}

/**
 * @param {object} [cfg]
 * @param {string} [root]
 */
export function resolveComputerEntryPath(cfg = {}, root = process.cwd()) {
  const eng = resolveComputerEngine(cfg);
  if (eng === "generated") {
    return path.join(root, "src/computer/generated/computer-server.mjs");
  }
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
    strategyPhase: "C4-bundle-default",
    policy: {
      defaultEngine: DEFAULT_COMPUTER_ENGINE,
      handEditBundle: false,
      lightweightEscape: "native|generated",
    },
  };
}

export default {
  resolveComputerEngine,
  isNativeComputer,
  isGeneratedComputer,
  resolveComputerEntryPath,
  describeComputerEngine,
};
