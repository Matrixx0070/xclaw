/**
 * Structured claims gate — fail-closed when principles demand evidence.
 * Used by jobs and agent completion path.
 */
import {
  scoreClaimsAgainstEvidence,
  parseStructuredClaims,
} from "../jobs/claims.mjs";
import {
  flagUngroundedClaims,
  groundingShouldFail,
} from "../jobs/evidence.mjs";
import { principlesForLevel } from "./principles.mjs";

/**
 * Resolve whether this run must refuse ungrounded claims.
 * @param {object} [cfg]
 * @param {object} [opts] job-level overrides
 */
export function resolveClaimsPolicy(cfg = {}, opts = {}) {
  const level =
    opts.autonomyLevel ||
    cfg?.autonomy?.level ||
    cfg?.profile ||
    "lab";
  let principles = {};
  try {
    principles = principlesForLevel(level) || {};
  } catch {
    principles = {};
  }
  const groundHard = Boolean(
    opts.groundHard ??
      opts.groundingHard ??
      cfg?.jobs?.groundHard ??
      principles.groundHard
  );
  const claimsRequireEvidence = Boolean(
    opts.claimsRequireEvidence ??
      cfg?.jobs?.claimsRequireEvidence ??
      principles.claimsRequireEvidence
  );
  const requireStructured = Boolean(
    opts.requireStructuredClaims ??
      cfg?.jobs?.requireStructuredClaims ??
      (claimsRequireEvidence &&
        (String(cfg?.profile || "").toLowerCase() === "prod" ||
          principles.claimsRequireEvidence))
  );
  return {
    groundHard,
    claimsRequireEvidence,
    requireStructured,
    hard: groundHard || claimsRequireEvidence,
    level,
  };
}

/**
 * Gate final agent/job text against evidence snapshot.
 */
export function gateStructuredClaims({
  text,
  evidence = [],
  cfg = {},
  opts = {},
} = {}) {
  const policy = resolveClaimsPolicy(cfg, opts);
  const score = scoreClaimsAgainstEvidence(text, evidence, {
    hard: policy.hard,
    requireStructured: policy.requireStructured,
    pathBind: policy.hard,
  });
  const groundWarn = flagUngroundedClaims(text, evidence, {
    hard: policy.groundHard,
  });
  const warnings = [...new Set([...(score.warnings || []), ...groundWarn])];
  const refuse =
    (policy.hard && !score.ok) ||
    groundingShouldFail(warnings, { hard: policy.groundHard });
  return {
    ok: !refuse && score.ok,
    refuse,
    policy,
    score,
    warnings,
    reason: refuse ? warnings[0] || "ungrounded_claims" : null,
    structured: parseStructuredClaims(text),
  };
}

/**
 * Apply gate to a job-like result; mutates status when refuse.
 */
export function applyClaimsGateToResult(result, ctx = {}) {
  const gate = gateStructuredClaims({
    text: result?.text || result?.finalText || "",
    evidence: ctx.evidence || result?.evidence || [],
    cfg: ctx.cfg || {},
    opts: ctx.opts || {},
  });
  if (gate.refuse) {
    return {
      ...result,
      ok: false,
      status: "failed",
      error: result?.error || gate.reason,
      groundingWarnings: gate.warnings,
      claimsGate: gate,
      pass: false,
    };
  }
  return {
    ...result,
    groundingWarnings: gate.warnings,
    claimsGate: gate,
  };
}

export default {
  resolveClaimsPolicy,
  gateStructuredClaims,
  applyClaimsGateToResult,
};
