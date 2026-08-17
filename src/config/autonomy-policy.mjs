/**
 * Autonomy levels — single knob mapping to security + agent + heartbeat defaults.
 *
 * Levels:
 *   off         — human-gated; no proactive heartbeat
 *   supervised  — safe tools auto; writes/exec need approval; no heartbeat
 *   lab         — trusted auto-approve; optional heartbeat (off by default)
 *   full        — lab + proactive heartbeat enabled (owner still set delivery)
 *
 * Explicit cfg fields always win over level defaults.
 */

import { TOOL_RISK, buildProdSecurityOverlay } from "../security/policy-matrix.mjs";

/** @typedef {"off"|"supervised"|"lab"|"full"} AutonomyLevel */

const LEVELS = new Set(["off", "supervised", "lab", "full"]);

/**
 * @param {object} cfg
 * @returns {AutonomyLevel}
 */
export function resolveAutonomyLevel(cfg = {}) {
  const raw = String(
    cfg.autonomy?.level ||
      process.env.XCLAW_AUTONOMY_LEVEL ||
      ""
  )
    .toLowerCase()
    .trim();
  if (LEVELS.has(raw)) return /** @type {AutonomyLevel} */ (raw);
  // Infer from profile when level unset
  const profile = String(cfg.profile || process.env.XCLAW_PROFILE || "lab").toLowerCase();
  if (profile === "prod") return "supervised";
  if (profile === "dev") return "supervised";
  return "lab";
}

/**
 * Build partial overlay for a level (does not clobber explicit user keys if merge carefully).
 * @param {AutonomyLevel} level
 */
export function autonomyOverlay(level) {
  switch (level) {
    case "off":
      return {
        security: {
          autoApprove: false,
          approvalPolicy: "always",
        },
        agent: { maxTurns: 8 },
        autonomy: {
          level: "off",
          heartbeat: { enabled: false },
        },
      };
    case "supervised": {
      const prod = buildProdSecurityOverlay();
      return {
        security: {
          ...prod,
          approvalPolicy: "risky",
        },
        agent: { maxTurns: 12 },
        autonomy: {
          level: "supervised",
          heartbeat: { enabled: false },
        },
      };
    }
    case "full":
      return {
        security: {
          autoApprove: true,
          approvalPolicy: "never",
        },
        agent: { maxTurns: 24 },
        autonomy: {
          level: "full",
          heartbeat: {
            enabled: true,
            everyMs: 1_800_000,
            silenceOk: true,
          },
        },
      };
    case "lab":
    default:
      return {
        security: {
          autoApprove: true,
          approvalPolicy: "never",
        },
        agent: { maxTurns: 20 },
        autonomy: {
          level: "lab",
          heartbeat: { enabled: false },
        },
      };
  }
}

/**
 * Deep-merge level overlay under cfg without wiping explicit arrays/objects the user set.
 * Level fills only missing/undefined leaves for security.autoApprove, approvalPolicy,
 * agent.maxTurns, autonomy.heartbeat.enabled when autonomy.level is set.
 *
 * @param {object} cfg
 * @returns {object} new cfg
 */
export function applyAutonomyLevel(cfg = {}) {
  const level = resolveAutonomyLevel(cfg);
  const over = autonomyOverlay(level);
  const out = { ...cfg, autonomy: { ...(cfg.autonomy || {}) }, security: { ...(cfg.security || {}) }, agent: { ...(cfg.agent || {}) } };

  out.autonomy.level = level;

  if (cfg.security?.autoApprove === undefined) {
    out.security.autoApprove = over.security.autoApprove;
  }
  if (cfg.security?.approvalPolicy === undefined) {
    out.security.approvalPolicy = over.security.approvalPolicy;
  }
  if (cfg.security?.safeAuto === undefined && over.security.safeAuto) {
    out.security.safeAuto = over.security.safeAuto;
  }
  if (cfg.security?.requireApproval === undefined && over.security.requireApproval) {
    out.security.requireApproval = over.security.requireApproval;
  }
  if (cfg.agent?.maxTurns === undefined && over.agent?.maxTurns != null) {
    out.agent.maxTurns = over.agent.maxTurns;
  }
  out.autonomy.heartbeat = {
    ...(over.autonomy.heartbeat || {}),
    ...(cfg.autonomy?.heartbeat || {}),
  };
  // If user never set enabled, take level default
  if (cfg.autonomy?.heartbeat?.enabled === undefined && over.autonomy.heartbeat?.enabled != null) {
    out.autonomy.heartbeat.enabled = over.autonomy.heartbeat.enabled;
  }
  return out;
}

/**
 * Doctor-friendly summary.
 */
export function autonomyPolicySummary(cfg = {}) {
  const applied = applyAutonomyLevel(cfg);
  const level = applied.autonomy?.level || resolveAutonomyLevel(cfg);
  return {
    level,
    autoApprove: Boolean(applied.security?.autoApprove),
    approvalPolicy: applied.security?.approvalPolicy || "risky",
    maxTurns: applied.agent?.maxTurns ?? null,
    heartbeatEnabled: Boolean(applied.autonomy?.heartbeat?.enabled),
    quietHoursEnabled: Boolean(applied.autonomy?.quietHours?.enabled),
    maxUsdPerDay: applied.autonomy?.maxUsdPerDay ?? null,
    toolRiskClasses: Object.keys(
      Object.fromEntries(
        Object.entries(TOOL_RISK).map(([k, v]) => [v, true])
      )
    ),
  };
}

export default {
  resolveAutonomyLevel,
  autonomyOverlay,
  applyAutonomyLevel,
  autonomyPolicySummary,
};
