/**
 * Lab (and explicit cfg) require checkpoint toolHashTip on resume.
 */
export function shouldRequireToolHashTip(cfg = {}, opts = {}) {
  if (opts.requireToolHashTip === true) return true;
  if (opts.requireToolHashTip === false) return false;
  if (cfg?.checkpoints?.requireToolHashTip === true) return true;
  if (cfg?.checkpoints?.requireToolHashTip === false) return false;
  const profile = String(cfg?.profile || cfg?.env || process.env.XCLAW_PROFILE || "").toLowerCase();
  return profile === "lab" || profile === "strict";
}

export default { shouldRequireToolHashTip };
