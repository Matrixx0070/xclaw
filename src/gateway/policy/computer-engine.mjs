/**
 * Gateway control-plane policy for the computer engine.
 *
 * Single engine — the unified CDP bundle (ADR 0006, 2026-08-24) — the
 * policy layer stays as the gateway's stable import surface for engine
 * observability (doctor, /dashboard, security snapshot).
 * Implementation lives in src/computer/engine.mjs.
 */

import {
  resolveComputerEngine,
  resolveComputerEntryPath,
  describeComputerEngine,
  isNativeComputer,
  DEFAULT_COMPUTER_ENGINE,
} from "../../computer/engine.mjs";

/** Engines allowed as long-term defaults. */
export const ALLOWED_DEFAULT_ENGINES = Object.freeze(["bundle"]);

/**
 * @param {object} [cfg]
 * @returns {"bundle"}
 */
export function policyResolveComputerEngine(cfg = {}) {
  return resolveComputerEngine(cfg);
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
  return {
    ok: true,
    engine,
    reason: "single unified bundle engine (A6 thin-server merge included)",
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
  validateComputerEnginePolicy,
  computerEnginePolicySnapshot,
  resolveComputerEngine,
  resolveComputerEntryPath,
  describeComputerEngine,
  isNativeComputer,
  DEFAULT_COMPUTER_ENGINE,
};
