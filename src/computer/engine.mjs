/**
 * Computer engine selection — native (thin) vs bundle (xclaw-server.mjs).
 *
 * Default: **native** (maintainable tools, no 16MB blob).
 * Bundle:  computer.engine="bundle" | XCLAW_COMPUTER_NATIVE=0 | XCLAW_COMPUTER_ENGINE=bundle
 */

/**
 * @param {object} [cfg]
 * @returns {"native" | "bundle"}
 */
export function resolveComputerEngine(cfg = {}) {
  const env = process.env.XCLAW_COMPUTER_ENGINE || process.env.XCLAW_COMPUTER_NATIVE;
  if (env === "0" || env === "false" || env === "bundle") return "bundle";
  if (env === "1" || env === "true" || env === "native") return "native";

  const eng = cfg.computer?.engine;
  if (eng === "bundle" || eng === "full" || eng === "xclaw-server") return "bundle";
  if (eng === "native" || eng === "thin") return "native";

  if (cfg.computer?.nativeServer === false) return "bundle";
  if (cfg.computer?.nativeServer === true) return "native";

  // Default: native
  return "native";
}

export function isNativeComputer(cfg = {}) {
  return resolveComputerEngine(cfg) === "native";
}

export default { resolveComputerEngine, isNativeComputer };
