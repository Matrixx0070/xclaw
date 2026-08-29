/**
 * A2 — Resolve and invoke browser hooks from the computer process.
 * Works when cwd or XCLAW_ROOT points at the package root.
 */
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { isHardenedProfile } from "../config/profiles.mjs";
import { jscodeMode } from "../browser/jscode-policy.mjs";

function candidateRoots() {
  const roots = [];
  if (process.env.XCLAW_ROOT) roots.push(process.env.XCLAW_ROOT);
  if (process.env.XCLAW_HOOKS_PATH) {
    // parent of hooks file
    roots.push(path.dirname(path.dirname(process.env.XCLAW_HOOKS_PATH)));
  }
  roots.push(process.cwd());
  // relative to this file: src/computer -> package root
  roots.push(path.resolve(path.dirname(new URL(import.meta.url).pathname), "../.."));
  return roots;
}

export function resolveHooksModulePath() {
  if (process.env.XCLAW_HOOKS_PATH && fs.existsSync(process.env.XCLAW_HOOKS_PATH)) {
    return process.env.XCLAW_HOOKS_PATH;
  }
  for (const root of candidateRoots()) {
    const p = path.join(root, "src/browser/hooks.mjs");
    if (fs.existsSync(p)) return p;
    const p2 = path.join(root, "browser/hooks.mjs");
    if (fs.existsSync(p2)) return p2;
  }
  return null;
}

let _hooks = null;
let _failed = false;

export async function loadHooks() {
  if (_hooks) return _hooks;
  if (_failed) return null;
  const p = resolveHooksModulePath();
  if (!p) {
    _failed = true;
    return null;
  }
  try {
    _hooks = await import(pathToFileURL(p).href);
    return _hooks;
  } catch (e) {
    console.error("[xclaw-hooks-bridge] load failed:", e?.message || e);
    _failed = true;
    return null;
  }
}

/**
 * Is the enforcement plane meant to be live in this process?
 *
 * The same question hooks.mjs asks itself, asked once here so the two planes
 * cannot drift: both env spellings it accepts, plus the profile route, because
 * the documented way to harden a host is profile:"prod" in the config, which
 * leaves every XCLAW_* variable unset.
 */
export function hooksEnforcementOn() {
  const l = readLevers();
  return l.fabricEnforce || l.commitGates || l.hardenedProfile;
}

/** The individual switches behind hooksEnforcementOn, read once. */
function readLevers() {
  return {
    fabricEnforce:
      process.env.XCLAW_FABRIC_ENFORCE === "1" || process.env.XCLAW_FABRIC_ENFORCE === "true",
    commitGates:
      process.env.XCLAW_COMMIT_GATES === "1" || process.env.XCLAW_COMMIT_GATES === "true",
    hardenedProfile: isHardenedProfile(),
  };
}

/**
 * The enforcement posture of THIS process, for a reader outside it.
 *
 * Every existing posture reader — doctor's a.hooks_status row, the live-e2e
 * probe — calls hooksStatus() in its own process and prints the answer as if
 * it described the computer server. It does not: the server is a separate,
 * long-lived process that inherits whatever environment it was spawned with,
 * and on this host that is none of the enforcement variables. So the probe set
 * the levers on itself, found the gates open, and reported them broken.
 *
 * Reported from here because this module is already loaded inside the server
 * (manager.mjs points XCLAW_HOOKS_BRIDGE at it by absolute path), so the
 * answer is an observation rather than an assumption. The pid travels with it:
 * a caller can then tell whose posture it is holding.
 *
 * Levers are reported individually, not collapsed into `enforcing` — "off"
 * without naming the switch is not actionable, and the switches have different
 * owners (env on a spawned computer, profile:"prod" in the config file).
 * jscodeMode is its own field for the same reason: jscodeMode() honours
 * XCLAW_ENFORCEMENT_STRICT and XCLAW_JSCODE_MODE, which the gate predicate
 * does not, so the two can legitimately disagree.
 */
export async function hooksEnforcementPosture() {
  const l = readLevers();
  return {
    enforcing: l.fabricEnforce || l.commitGates || l.hardenedProfile,
    fabricEnforce: l.fabricEnforce,
    commitGates: l.commitGates,
    hardenedProfile: l.hardenedProfile,
    jscodeMode: jscodeMode(),
    // Whether anything is actually there to say no. Enforcement on with no
    // usable hooks module fails closed (see unavailable() below), but a reader
    // cannot infer that without knowing which case it is in.
    //
    // This asks whether the module LOADS, not whether a file exists at the
    // resolved path. resolveHooksModulePath() falls back to process.cwd() and
    // to this file's own ../.., so on any normal checkout it can never return
    // null -- it would report a constant true dressed as an observation. A
    // module that throws on import is the other half of the fail-closed
    // condition, and only loadHooks() sees it.
    hooksModule: Boolean(await loadHooks()),
    pid: process.pid,
  };
}

/**
 * What a gate returns when the enforcement plane it fronts could not be loaded.
 *
 * Every gate here needs it: the caller checks r.ok === false and nothing else,
 * so { ok: true, skipped: true } reads to it exactly like an approval. A gate
 * that skips silently under enforcement permits the action it exists to judge.
 */
function unavailable(phase) {
  return {
    ok: false,
    code: "HOOKS_UNAVAILABLE",
    reason: "hooks module not found while enforcement is on",
    phase,
  };
}

export async function runBeforeNavigate(ctx) {
  const h = await loadHooks();
  if (!h?.beforeNavigate) {
    if (hooksEnforcementOn()) return unavailable("beforeNavigate");
    return { ok: true, skipped: true };
  }
  return h.beforeNavigate(ctx);
}

export async function runBeforeInput(ctx) {
  const h = await loadHooks();
  if (!h?.beforeInput) {
    if (hooksEnforcementOn()) return unavailable("beforeInput");
    return { ok: true, skipped: true };
  }
  return h.beforeInput(ctx);
}

export async function runAfterAction(ctx, result) {
  const h = await loadHooks();
  if (!h?.afterAction) return { ok: true, skipped: true };
  return h.afterAction(ctx, result);
}

export async function runBuildChromeArgs(baseArgs, ctx) {
  const h = await loadHooks();
  if (!h?.buildChromeArgs) return baseArgs;
  return h.buildChromeArgs(baseArgs, ctx);
}
