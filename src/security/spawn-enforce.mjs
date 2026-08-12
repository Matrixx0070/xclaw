/**
 * Spawn-time plan enforcement — last gate before exec.
 *
 * Approval freezes a systemRunPlan. This module ensures the computer plane
 * only runs the frozen command (exact string) with a non-login shell and
 * optional cwd pin — not a mutated args object or bash -lc (login profile).
 *
 * Config / env:
 *   security.spawnEnforce: "off" | "check" | "strict"  (default: check when plan present)
 *   XCLAW_SPAWN_ENFORCE=off|check|strict
 */

import fs from "node:fs";
import path from "node:path";
import { planFingerprint, revalidatePlan, PLAN_VERSION } from "./system-run-plan.mjs";

function tryRealpath(value) {
  if (!value || typeof value !== "string") return null;
  try {
    return fs.realpathSync.native
      ? fs.realpathSync.native(value)
      : fs.realpathSync(value);
  } catch {
    return null;
  }
}

/**
 * @param {object} [cfg]
 * @returns {"off"|"check"|"strict"}
 */
export function getSpawnEnforceMode(cfg = {}) {
  const env = String(process.env.XCLAW_SPAWN_ENFORCE || "").toLowerCase();
  if (env === "off" || env === "0" || env === "false") return "off";
  if (env === "strict" || env === "1" || env === "true") return "strict";
  if (env === "check") return "check";
  const m = String(cfg?.security?.spawnEnforce || cfg?.spawnEnforce || "").toLowerCase();
  if (m === "off" || m === "check" || m === "strict") return m;
  // Default: check when a plan is supplied; strict in prod profile
  if ((cfg?.profile || process.env.XCLAW_PROFILE) === "prod") return "check";
  return "check";
}

/**
 * Assert frozen plan matches the command about to run.
 * @returns {{ ok: true, command: string, cwd: string } | { ok: false, error: string, reason: string }}
 */
export function assertPlanAtSpawn({ plan, command, cwd, mode = "check" } = {}) {
  if (mode === "off") {
    return {
      ok: true,
      command: String(command || ""),
      cwd: cwd || process.cwd(),
      enforced: false,
    };
  }

  if (!plan) {
    if (mode === "strict") {
      return {
        ok: false,
        reason: "missing_plan",
        error: "spawn enforce strict: systemRunPlan required for exec",
      };
    }
    return {
      ok: true,
      command: String(command || ""),
      cwd: cwd || process.cwd(),
      enforced: false,
    };
  }

  if (plan.version != null && plan.version !== PLAN_VERSION) {
    return {
      ok: false,
      reason: "plan_version",
      error: `spawn enforce: plan version mismatch (got ${plan.version})`,
    };
  }

  const rv = revalidatePlan(plan);
  if (!rv.ok) {
    return {
      ok: false,
      reason: rv.reason || "plan_drift",
      error: `spawn enforce: ${rv.message || rv.reason}`,
      drift: rv.drift,
    };
  }

  const frozenCmd = String(plan.command ?? "");
  const liveCmd = String(command ?? "");
  if (frozenCmd !== liveCmd) {
    return {
      ok: false,
      reason: "command_mismatch",
      error:
        "spawn enforce: live command does not match frozen plan.command (refusing mutated args)",
      expected: frozenCmd.slice(0, 200),
      actual: liveCmd.slice(0, 200),
    };
  }

  // Fingerprint must still match (catches argv/cwd/exe field edits on the plan object)
  const fp = planFingerprint(plan);
  if (plan.fingerprint && fp !== plan.fingerprint) {
    return {
      ok: false,
      reason: "fingerprint_mismatch",
      error: "spawn enforce: plan fingerprint mismatch at spawn",
    };
  }

  let runCwd = plan.cwd || cwd || process.cwd();
  if (cwd && plan.cwd) {
    const live = tryRealpath(path.resolve(cwd)) || path.resolve(cwd);
    const pin = tryRealpath(plan.cwd) || plan.cwd;
    if (live !== pin) {
      return {
        ok: false,
        reason: "cwd_mismatch",
        error: `spawn enforce: cwd drift at spawn (plan=${pin} live=${live})`,
      };
    }
    runCwd = pin;
  }

  return {
    ok: true,
    command: frozenCmd,
    cwd: runCwd,
    enforced: true,
    planFingerprint: plan.fingerprint,
  };
}

/**
 * Build spawn() arguments for an enforced bash run.
 * Uses non-login shell (-c not -lc) so profile PATH cannot swap binaries.
 * Prefer pinned bash realpath when available.
 *
 * @returns {{ exe: string, argv: string[], cwd: string, env: NodeJS.ProcessEnv }}
 */
export function buildEnforcedBashSpawn({ plan, command, cwd, env } = {}) {
  const bashCandidates = ["/bin/bash", "/usr/bin/bash"];
  let bash = "/bin/bash";
  for (const c of bashCandidates) {
    const real = tryRealpath(c);
    if (real) {
      bash = real;
      break;
    }
  }
  // If plan pinned an exe that is bash, prefer that realpath
  if (plan?.exe && /bash$/.test(String(plan.exe))) {
    const real = tryRealpath(plan.exe) || plan.exe;
    bash = real;
  }

  const cmd = plan?.command != null ? String(plan.command) : String(command || "");
  const runCwd = plan?.cwd || cwd || process.cwd();

  // Minimal env: do not pass full process.env when strict? — keep process.env for usability
  // but strip obvious injection of BASH_ENV / ENV that reintroduces rc files
  const base = { ...(env || process.env) };
  delete base.BASH_ENV;
  delete base.ENV;
  // non-interactive, no rc
  base.BASH_ENV = "";
  base.ENV = "";

  return {
    exe: bash,
    // -c only (NOT -lc): no login profile, PATH stays closer to spawn env
    argv: ["-c", cmd],
    cwd: runCwd,
    env: base,
    shell: false,
  };
}

export default {
  getSpawnEnforceMode,
  assertPlanAtSpawn,
  buildEnforcedBashSpawn,
};
