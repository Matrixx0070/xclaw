/**
 * Gateway control-plane policy for computer engine selection (Strategy C4).
 *
 * Owns the *decision surface* the gateway uses; implementation remains in
 * src/computer/engine.mjs. Do not resolve engines ad-hoc in routes.
 */

import {
  resolveComputerEngine,
  resolveComputerEntryPath,
  describeComputerEngine,
  isNativeComputer,
  isGeneratedComputer,
} from "../../computer/engine.mjs";

/** Engines allowed as long-term defaults under C4. */
export const ALLOWED_DEFAULT_ENGINES = Object.freeze(["native", "generated"]);

/**
 * @param {object} [cfg]
 * @returns {{"native"|"generated"|"bundle"}}
 */
export function policyResolveComputerEngine(cfg = {}) {
  return resolveComputerEngine(cfg);
}

/**
 * Whether the resolved engine is an explicit fallback (legacy blob).
 * @param {object} [cfg]
 */
export function isBundleFallback(cfg = {}) {
  return resolveComputerEngine(cfg) === "bundle";
}

/**
 * Fail closed if config tries to set an invalid default for production policy.
 * Bundle is allowed only as explicit override (env or cfg.computer.engine).
 *
 * @param {object} [cfg]
 * @returns {{ ok: boolean, engine: string, reason?: string }}
 */
export function validateComputerEnginePolicy(cfg = {}) {
  const engine = resolveComputerEngine(cfg);
  const explicit =
    Boolean(process.env.XCLAW_COMPUTER_ENGINE) ||
    Boolean(process.env.XCLAW_COMPUTER_NATIVE) ||
    cfg.computer?.engine != null ||
    cfg.computer?.nativeServer != null;

  if (engine === "bundle" && !explicit) {
    return {
      ok: false,
      engine,
      reason: "bundle selected without explicit override (C4 forbids implicit default)",
    };
  }

  if (engine === "bundle") {
    return {
      ok: true,
      engine,
      reason: "explicit bundle fallback",
      warning: true,
    };
  }

  if (!ALLOWED_DEFAULT_ENGINES.includes(engine)) {
    return { ok: false, engine, reason: `unknown engine: ${engine}` };
  }

  return { ok: true, engine };
}

/**
 * Snapshot for /doctor, /dashboard, logs.
 * @param {object} [cfg]
 * @param {string} [root]
 */
export function computerEnginePolicySnapshot(cfg = {}, root = process.cwd()) {
  const described = describeComputerEngine(cfg, root);
  const validation = validateComputerEnginePolicy(cfg);
  return {
    ...described,
    validation,
    controlPlane: "gateway",
    capabilityPlane: "computer",
  };
}

export {
  resolveComputerEngine,
  resolveComputerEntryPath,
  describeComputerEngine,
  isNativeComputer,
  isGeneratedComputer,
};

export default {
  ALLOWED_DEFAULT_ENGINES,
  policyResolveComputerEngine,
  isBundleFallback,
  validateComputerEnginePolicy,
  computerEnginePolicySnapshot,
  resolveComputerEngine,
  resolveComputerEntryPath,
  describeComputerEngine,
  isNativeComputer,
  isGeneratedComputer,
};
