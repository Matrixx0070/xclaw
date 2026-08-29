/**
 * Deploy profiles: dev (local), lab (trusted auto-approve), prod (strict).
 */
export const PROFILES = {
  dev: {
    description: "Local development — localhost, auto-approve for low-setup bots",
    gateway: { host: "127.0.0.1" },
    security: { autoApprove: true, approvalPolicy: "risky" },
    readiness: { requireComputer: false },
    agent: {
      maxTurns: 15,
      loopGuard: {
        enabled: true,
        historySize: 40,
        warningThreshold: 12,
        criticalThreshold: 20,
        globalCircuitBreakerThreshold: 40,
        circuitBreaker: 40,
      },
    },
    eval: { cron: { enabled: true } },
  },
  lab: {
    description: "Trusted lab sandbox — auto-approve tools for eval/autonomy (low-setup default)",
    gateway: { host: "127.0.0.1" },
    security: { autoApprove: true, approvalPolicy: "never" },
    sandbox: { enabled: true, allowPaths: ["/tmp"] },
    readiness: { requireComputer: false },
    jobs: {
      structuredClaimsOnTags: ["campaign", "long"],
    },
    // Tight prompt budgets: live traffic showed ~9.5k input / ~$0.012 with
    // only ~2% cache hits — most tokens were static skills/tools, not the ask.
    skills: {
      progressive: true,
      maxChars: 1800,
      inlineMaxChars: 600,
    },
    memory: {
      maxChars: 1500,
    },
    tokens: {
      restorePrefixEachTurn: true,
      // Truncate verbose tool descriptions in the model schema payload
      maxToolDescriptionChars: 160,
    },
    router: {
      roleEffortEnabled: true,
      roleEffort: { draft: "low", act: "low", verify: "high", strong: "high" },
    },
    agent: {
      maxTurns: 20,
      // Prefer pack name; allowTools still wins if set explicitly as array
      toolPack: "act",
      // Repo/multi-step goals need headroom above 30 tool calls
      loopGuard: {
        enabled: true,
        historySize: 80,
        warningThreshold: 15,
        criticalThreshold: 30,
        globalCircuitBreakerThreshold: 60,
        circuitBreaker: 60,
      },
    },
    eval: { cron: { enabled: true } },
  },
  prod: {
    description: "Production-ish — strict approvals, require gateway token, structured claims on long/campaign",
    gateway: { host: "127.0.0.1", requireAuth: true, publicUi: false },
    jobs: {
      groundHard: true,
      claimsRequireEvidence: true,
      requireStructuredClaims: false,
      structuredClaimsOnTags: ["campaign", "long", "campaign-v2", "hard"],
    },
    security: {
      autoApprove: false,
      bindSystemRunPlan: true,
      approvalPolicy: "risky",
      // P2 honesty: prod defaults match the label
      egress: { mode: "deny" },
      osSandbox: "auto",
      spawnEnforce: "check",
      // Tool spawns see only a base env allowlist (+security.envAllow)
      bashEnv: "allowlist",
      // Every tool this codebase declares mutating (FORCE_SERIAL in
      // src/agent/tool-concurrency.mjs). The list is enumerated, and under
      // approvalPolicy "risky" an omission means AUTO-RUN — so a served tool
      // nobody typed here ran unasked. test/mutating-tools-approval.test.mjs
      // fails if this list and that set drift apart again.
      requireApproval: [
        "xclaw_bash",
        "bash",
        "shell",
        "exec",
        "xclaw_exec",
        "run_terminal",
        "xclaw_file_write",
        "file_write",
        "write_file",
        "xclaw_file_edit",
        "file_edit",
        "edit_file",
        "xclaw_browser_tab",
        "browser_tab",
        "xclaw_computer_act",
        "computer_act",
        "xclaw_spawn_subagent",
        "xclaw_swarm_run",
        "xclaw_swarm_merge_approve",
        "xclaw_swarm_merge_reject",
      ],
      safeAuto: [
        "xclaw_file_read",
        "file_read",
        "read_file",
        "xclaw_file_list",
        "list_dir",
      ],
    },
    swarm: {
      autoMerge: false,
      earlyMergeImplement: false,
    },
    agent: {
      maxTurns: 12,
      loopGuard: {
        enabled: true,
        historySize: 30,
        warningThreshold: 8,
        criticalThreshold: 15,
        globalCircuitBreakerThreshold: 25,
        circuitBreaker: 25,
      },
    },
    retry: { retries: 3, strategy: "full", respectRetryAfter: true },
    eval: { cron: { enabled: false } }, // manual eval in prod
  },
};

/**
 * `strict` is not a typo — profiles.mjs's own header calls prod "(strict)" and
 * sixteen source files test `profile === "strict"` as the hardened case. The
 * config layer was the one reader that had never learned the name, so it
 * applied no pack at all and the most hardened-sounding value produced the
 * least hardened host.
 */
export const PROFILE_ALIASES = { strict: "prod" };

/**
 * Resolve an operator's free-form profile string to one canonical id.
 *
 * Three gates each used to normalise for themselves — enforceProdHardening
 * lowercased, the security audit compared raw, applyProfile did an exact key
 * lookup — so `Prod` hardened the config while the audit graded it a non-prod
 * host, and `strict` satisfied neither. Normalising in one place is what keeps
 * them agreeing.
 *
 * @param {string} raw
 * @returns {{ input: string, id: string, known: boolean }}
 */
export function resolveProfileName(raw) {
  const input = String(raw ?? "").trim();
  const lower = input.toLowerCase();
  const id = PROFILE_ALIASES[lower] || lower;
  return { input, id, known: Object.hasOwn(PROFILES, id) };
}

/**
 * The canonical profile this process resolved at load time, or null before
 * loadConfig has run.
 *
 * Gates that live below the config layer — a browser hook, a policy module
 * reached through a bridge — cannot be handed a cfg, so they used to ask
 * process.env.XCLAW_PROFILE directly. Nothing in src/ or bin/ ever assigns
 * that variable: an operator who hardened the host the documented way, with
 * profile:"prod" in xclaw.json, left it unset, and every such gate silently
 * read "unhardened" while the rest of the config agreed the host was prod.
 * loadConfig publishes the settled name here so those gates can ask the same
 * question and get the same answer.
 *
 * @type {string|null}
 */
let activeProfile = null;

/**
 * Publish the profile this process is running under. Called once by loadConfig
 * after it settles the name; pass null to clear (tests).
 *
 * @param {string|null} name canonical profile id
 */
export function setActiveProfile(name) {
  activeProfile = name || null;
}

/**
 * The published profile, or null if loadConfig has not run in this process.
 *
 * @returns {string|null}
 */
export function getActiveProfile() {
  return activeProfile;
}

/**
 * True when the resolved profile is the hardened one. The single answer to
 * "is this host hardened?", for every gate that needs to ask.
 *
 * An explicit source always outranks the published one: a caller holding a cfg
 * is asking about THAT config, not about the process.
 *
 * @param {object|string} source cfg, or a bare profile name
 */
export function isHardenedProfile(source) {
  const name =
    typeof source === "string"
      ? source
      : source?.profile || activeProfile || process.env.XCLAW_PROFILE || "";
  return resolveProfileName(name).id === "prod";
}

/**
 * Canonical id for a known profile; the operator's own spelling for anything
 * else, so the audit can quote back exactly what they typed rather than a
 * guess. Use this wherever a profile name is stored or compared.
 *
 * @param {string} raw
 * @returns {string}
 */
export function canonicalProfileName(raw) {
  const r = resolveProfileName(raw);
  return r.known ? r.id : r.input;
}

/**
 * Apply profile defaults onto cfg.
 * Call BEFORE merging user file so explicit user security/agent settings win.
 * Order in loadConfig: DEFAULT → applyProfile → user → env
 */
export function applyProfile(cfg) {
  const { input, id, known } = resolveProfileName(
    cfg.profile || process.env.XCLAW_PROFILE || "dev"
  );
  if (!known) {
    // Reported as an audit error too (security/audit.mjs profile.unknown): a
    // boot warning nobody reads is how a typo'd XCLAW_PROFILE ran a host on
    // full auto-approve while the operator believed they had hardened it.
    console.warn(
      `[xclaw] unknown profile "${input}" — no profile pack applied; valid: ${Object.keys(PROFILES).join(", ")}`
    );
    return cfg;
  }
  const prof = PROFILES[id];
  const out = { ...cfg, profile: id };
  for (const [k, v] of Object.entries(prof)) {
    if (k === "description") continue;
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object") {
      // Capture nested packs before shallow spread overwrites them
      const prevAgentGuard =
        k === "agent" ? { ...(out.agent?.loopGuard || {}) } : null;
      out[k] = { ...out[k], ...v };
      // nested security.requireApproval etc already shallow
      if (k === "security" && v.requireApproval) {
        out.security = { ...out.security, ...v };
      }
      if (k === "eval" && v.cron) {
        out.eval = { ...out.eval, cron: { ...(out.eval?.cron || {}), ...v.cron } };
      }
      if (k === "agent" && v.loopGuard) {
        out.agent.loopGuard = {
          ...prevAgentGuard,
          ...v.loopGuard,
          detectors: {
            ...(prevAgentGuard?.detectors || {}),
            ...(v.loopGuard.detectors || {}),
          },
        };
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
