/**
 * Deploy profiles: dev (local), lab (trusted auto-approve), prod (strict).
 */
export const PROFILES = {
  dev: {
    description: "Local development — localhost, auto-approve for low-setup bots",
    gateway: { host: "127.0.0.1" },
    security: { autoApprove: true, approvalPolicy: "risky" },
    readiness: { requireComputer: false },
    agent: { maxTurns: 15 },
    eval: { cron: { enabled: true } },
  },
  lab: {
    description: "Trusted lab sandbox — auto-approve tools for eval/autonomy (low-setup default)",
    gateway: { host: "127.0.0.1" },
    security: { autoApprove: true, approvalPolicy: "never" },
    readiness: { requireComputer: false },
    jobs: {
      structuredClaimsOnTags: ["campaign", "long"],
    },
    agent: { maxTurns: 20 },
    eval: { cron: { enabled: true } },
  },
  prod: {
    description: "Production-ish — strict approvals, structured claims on long/campaign",
    gateway: { host: "127.0.0.1" },
    jobs: {
      groundHard: true,
      claimsRequireEvidence: true,
      requireStructuredClaims: false,
      structuredClaimsOnTags: ["campaign", "long", "campaign-v2", "hard"],
    },
    security: {
      autoApprove: false,
      approvalPolicy: "risky",
      requireApproval: [
        "xclaw_bash",
        "bash",
        "xclaw_file_write",
        "file_write",
        "xclaw_browser_tab",
        "browser_tab",
      ],
      safeAuto: [
        "xclaw_file_read",
        "file_read",
        "read_file",
        "xclaw_file_list",
        "list_dir",
      ],
    },
    agent: { maxTurns: 12 },
    retry: { retries: 3, strategy: "full", respectRetryAfter: true },
    eval: { cron: { enabled: false } }, // manual eval in prod
  },
};

/**
 * Apply profile defaults onto cfg.
 * Call BEFORE merging user file so explicit user security/agent settings win.
 * Order in loadConfig: DEFAULT → applyProfile → user → env
 */
export function applyProfile(cfg) {
  const name = cfg.profile || process.env.XCLAW_PROFILE || "dev";
  const prof = PROFILES[name];
  if (!prof) {
    console.warn(`[xclaw] unknown profile "${name}" — using config as-is`);
    return cfg;
  }
  const out = { ...cfg, profile: name };
  for (const [k, v] of Object.entries(prof)) {
    if (k === "description") continue;
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object") {
      out[k] = { ...out[k], ...v };
      // nested security.requireApproval etc already shallow
      if (k === "security" && v.requireApproval) {
        out.security = { ...out.security, ...v };
      }
      if (k === "eval" && v.cron) {
        out.eval = { ...out.eval, cron: { ...(out.eval?.cron || {}), ...v.cron } };
      }
      if (k === "agent") {
        out.agent = { ...out.agent, ...v };
      }
      if (k === "retry") {
        out.retry = { ...out.retry, ...v };
      }
      if (k === "gateway") {
        out.gateway = { ...out.gateway, ...v };
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function listProfiles() {
  return Object.entries(PROFILES).map(([id, p]) => ({
    id,
    description: p.description,
  }));
}
