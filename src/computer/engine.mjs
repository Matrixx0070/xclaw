/**
 * Computer engine selection — Strategy C.
 *
 * - native / thin: thin-server.mjs (lab modules)
 * - generated: generated/computer-server.mjs (esbuild from modules) — C3
 * - bundle: xclaw-server.mjs (~16MB CDP runtime; do not hand-edit)
 *
 * Transitional default: native.
 * Build: npm run build:computer
 */
import path from "node:path";

/**
 * @param {object} [cfg]
 * @returns {"native" | "generated" | "bundle"}
 */
export function resolveComputerEngine(cfg = {}) {
  const env = process.env.XCLAW_COMPUTER_ENGINE || process.env.XCLAW_COMPUTER_NATIVE;
  if (env === "0" || env === "false" || env === "bundle") return "bundle";
  if (env === "generated" || env === "gen" || env === "c3") return "generated";
  if (env === "1" || env === "true" || env === "native" || env === "thin") return "native";

  const eng = cfg.computer?.engine;
  if (eng === "bundle" || eng === "full" || eng === "xclaw-server") return "bundle";
  if (eng === "generated" || eng === "gen") return "generated";
  if (eng === "native" || eng === "thin") return "native";

  if (cfg.computer?.nativeServer === false) return "bundle";
  if (cfg.computer?.nativeServer === true) return "native";

  return "native";
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

export default {
  resolveComputerEngine,
  isNativeComputer,
  isGeneratedComputer,
  resolveComputerEntryPath,
};
