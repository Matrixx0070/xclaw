/**
 * F — Prod profile honesty checks (pure; used by doctor).
 * Label "prod" must not lie: autoApprove, open auth, autoMerge, missing token.
 */

/**
 * @param {object} cfg
 * @returns {Array<{ id: string, status: "ok"|"warn"|"error", message: string }>}
 */
export function prodHonestyChecks(cfg = {}) {
  const out = [];
  const prof = cfg.profile || "lab";
  if (prof !== "prod") {
    out.push({
      id: "security.prodHonesty",
      status: "ok",
      message: `profile=${prof} — prod honesty checks skipped`,
    });
    return out;
  }

  const token =
    cfg.gateway?.token ||
    process.env.XCLAW_GATEWAY_TOKEN ||
    process.env.GATEWAY_TOKEN ||
    null;
  if (!token) {
    out.push({
      id: "security.prod.token",
      status: "error",
      message:
        "prod requires XCLAW_GATEWAY_TOKEN / gateway.token — fail closed before exposing the gateway",
    });
  } else {
    out.push({
      id: "security.prod.token",
      status: "ok",
      message: "gateway token present",
    });
  }

  if (cfg.security?.autoApprove === true) {
    out.push({
      id: "security.prod.autoApprove",
      status: "error",
      message:
        "prod must not autoApprove tools (override detected in config/env) — remove security.autoApprove or set false",
    });
  } else {
    out.push({
      id: "security.prod.autoApprove",
      status: "ok",
      message: "autoApprove=false",
    });
  }

  const eg = cfg.security?.egress?.mode || process.env.XCLAW_EGRESS || "deny";
  if (String(eg).toLowerCase() === "allow") {
    out.push({
      id: "security.prod.egress",
      status: "warn",
      message:
        "prod egress mode=allow — outbound shell network is open; prefer deny or allowlist",
    });
  } else {
    out.push({
      id: "security.prod.egress",
      status: "ok",
      message: `egress mode=${eg}`,
    });
  }

  if (cfg.swarm?.autoMerge === true) {
    out.push({
      id: "security.prod.swarmAutoMerge",
      status: "error",
      message: "prod must not autoMerge swarm worktrees onto main",
    });
  } else {
    out.push({
      id: "security.prod.swarmAutoMerge",
      status: "ok",
      message: `swarm.autoMerge=${cfg.swarm?.autoMerge === true}`,
    });
  }

  if (cfg.gateway?.requireAuth === false) {
    out.push({
      id: "security.prod.requireAuth",
      status: "error",
      message: "prod gateway.requireAuth is false — open auth plane",
    });
  } else {
    out.push({
      id: "security.prod.requireAuth",
      status: "ok",
      message: `requireAuth=${cfg.gateway?.requireAuth !== false}`,
    });
  }

  return out;
}

/**
 * Profile label vs effective security (mismatch detector).
 * @param {object} cfg
 */
export function profileMismatchChecks(cfg = {}) {
  const out = [];
  const name = cfg.profile || "lab";
  const auto = cfg.security?.autoApprove === true;
  if (name === "prod" && auto) {
    out.push({
      id: "profile.mismatch",
      status: "error",
      message:
        'profile is "prod" but security.autoApprove is true — user xclaw.json/env override; tools will not require approval',
    });
  } else if ((name === "lab" || name === "dev") && cfg.security?.autoApprove === false) {
    out.push({
      id: "profile.mismatch",
      status: "warn",
      message: `profile is "${name}" but security.autoApprove is false — user override; bots may hang on tools until /approve`,
    });
  } else {
    out.push({
      id: "profile",
      status: "ok",
      message: `profile=${name} autoApprove=${auto} approvalPolicy=${cfg.security?.approvalPolicy || "—"}`,
    });
  }
  return out;
}

export default { prodHonestyChecks, profileMismatchChecks };
