/**
 * Doctor-facing skill integrity posture (kept separate from integrity.mjs
 * so prod lockfile policy can evolve without touching the loader).
 */
import {
  LOCKFILE_NAME,
  resolveIntegrityMode,
} from "./integrity.mjs";

/**
 * Prod without a lockfile is an error — unpinned skills must not ship.
 * @returns {{ id: string, status: "ok"|"warn"|"error", message: string }}
 */
export function doctorSkillsIntegrityCheck(
  cfg = {},
  { hasLockfile = false, driftCount = 0, mode = null } = {}
) {
  const profile = String(
    cfg?.profile || process.env.XCLAW_PROFILE || "lab"
  ).toLowerCase();
  const resolved = mode || resolveIntegrityMode(cfg, hasLockfile);
  if (!hasLockfile) {
    if (profile === "prod") {
      return {
        id: "skills.integrity",
        status: "error",
        message: `no ${LOCKFILE_NAME} — prod injects unpinned skills (run: xclaw skills lock)`,
      };
    }
    return {
      id: "skills.integrity",
      status: "ok",
      message: `no ${LOCKFILE_NAME} (integrity off — optional: xclaw skills lock)`,
    };
  }
  if (driftCount > 0) {
    return {
      id: "skills.integrity",
      status: "warn",
      message: `${driftCount} skill(s) drifted from lockfile (mode=${resolved}) — xclaw skills verify`,
    };
  }
  return {
    id: "skills.integrity",
    status: "ok",
    message: `lockfile present mode=${resolved}`,
  };
}

export default { doctorSkillsIntegrityCheck };
