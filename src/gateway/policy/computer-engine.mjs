/**
 * Gateway control-plane policy for computer engine selection.
 *
 * Product default: full CDP bundle. native remains the lightweight escape hatch (generated deleted in S4, 2026-08-23).
 * Implementation lives in src/computer/engine.mjs.
 */

import {
  resolveComputerEngine,
  resolveComputerEntryPath,
  describeComputerEngine,
  isNativeComputer,
  DEFAULT_COMPUTER_ENGINE,
} from "../../computer/engine.mjs";

/** Engines allowed as long-term defaults (product + escape hatches). */
export const ALLOWED_DEFAULT_ENGINES = Object.freeze([
  "bundle",
  "native",
]);

/**
 * @param {object} [cfg]
 * @returns {"native"|"bundle"}
 */
export function policyResolveComputerEngine(cfg = {}) {
  return resolveComputerEngine(cfg);
}

/**
 * True when operator explicitly forced the legacy "bundle as fallback only" path.
 * With product default = bundle, this is false for ordinary default resolution.
 * @param {object} [cfg]
 */
export function isBundleFallback(cfg = {}) {
  return (
    resolveComputerEngine(cfg) === "bundle" &&
    DEFAULT_COMPUTER_ENGINE !== "bundle"
  );
}

/**
 * @param {object} [cfg]
 * @returns {{ ok: boolean, engine: string, reason?: string, warning?: boolean }}
 */
export function validateComputerEnginePolicy(cfg = {}) {
  const engine = resolveComputerEngine(cfg);

  if (!ALLOWED_DEFAULT_ENGINES.includes(engine)) {
    return { ok: false, engine, reason: `unknown engine: ${engine}` };
  }

  if (engine === "native" || engine === "generated") {
    return {
      ok: true,
      engine,
      reason: "lightweight escape hatch",
      warning: false,
    };
  }

  // bundle is the product default
  return {
    ok: true,
    engine,
    reason: "product default full CDP bundle",
    warning: false,
  };
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
  DEFAULT_COMPUTER_ENGINE,
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
  DEFAULT_COMPUTER_ENGINE,
};
