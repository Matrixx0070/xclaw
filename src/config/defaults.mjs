/** Default XClaw configuration */
export const DEFAULT_CONFIG = {
  version: 1,
  /** dev | lab | prod — applied via applyProfile() in loadConfig */
  profile: "lab",  // low-setup default; use prod for strict approvals
  gateway: {
    /** Operator token — also XCLAW_GATEWAY_TOKEN */
    token: null,
    authStrict: true,
    protectMetrics: false,
    publicUi: true,
    tls: { cert: "", key: "", ca: "" },
    /** Require Bearer token on /metrics when true and token set */
    protectMetrics: false,
    host: "127.0.0.1",
    port: 18790,
    /**
     * Effective listen host is resolved from this at startup
     * (src/net/tailscale.mjs resolveGatewayBindHost):
     *   loopback|auto → 127.0.0.1, lan → 0.0.0.0, tailnet → the tailnet IP,
     *   custom (default) → the explicit `host` above, unchanged (back-compat).
     */
    bind: "custom",
    /**
     * Tailscale exposure (docs/TAILSCALE.md):
     *   off    — no exposure; gateway stays on loopback (default)
     *   serve  — private HTTPS for machines on your tailnet
     *   funnel — public HTTPS on the internet (ports 443/8443/10000 only)
     * serve/funnel force the gateway to bind loopback; funnel forces auth on.
     * resetOnExit runs `tailscale serve|funnel reset` on gateway shutdown.
     */
    tailscale: { mode: "off", resetOnExit: false },
  },
  /**
   * Stream resume buffers (agent / swarm / webchat) + client backoff defaults.
   * Env overrides: XCLAW_STREAM_CAPACITY, XCLAW_STREAM_TTL_MS, XCLAW_STREAM_HEARTBEAT_MS,
   *                XCLAW_STREAM_BACKOFF, XCLAW_STREAM_BASE_MS, XCLAW_STREAM_MAX_MS
   */
  stream: {
    /** Max events retained per streamId (ring buffer) */
    capacity: 500,
    /** TTL after markEnded before GC (ms) */
    ttlMs: 300_000,
    /** SSE/NDJSON heartbeat interval (ms); 0 disables */
    heartbeatMs: 15_000,
    /** Client outer-resume backoff defaults */
    backoff: "full",
    baseMs: 1_000,
    maxMs: 30_000,
    /** Default outer resume cycles for CLI (0 = infinite in client) */
    maxResumeCycles: 5,
  },
  /** Named workspaces for multi-root isolation */
  workspaces: {
    // default: { path: process.cwd() }
  },
  computer: {
    /**
     * Single engine (ADR 0006): the unified CDP bundle xclaw-server.mjs,
     * carrying the thin server's functions via the A6 merge (bwrap bash,
     * per-call cwd, systemRunPlan assert, xclaw_computer_act). Legacy
     * engine/nativeServer selectors resolve to bundle (src/computer/engine.mjs).
     */
    /** Optional remote computer base URL (sidecar) */
    remoteUrl: null,
    authToken: null,
    authHmac: false,
    host: "127.0.0.1",
    port: 4243,
    autoStart: true,
    startTimeoutMs: 45_000,
    env: {},
    watchdog: {
      enabled: true,
      intervalMs: 30_000,
      minRestartIntervalMs: 60_000,
      maxConsecutiveFails: 5,
    },
  },
  /**
   * B0 — Human-like Chromium (durable profile + headed + humanize).
   * Env overrides win: XCLAW_BROWSER_PROFILE_DIR, XCLAW_BROWSER_HEADED,
   * XCLAW_BROWSER_HUMANIZE, XCLAW_BROWSER_HUMANIZE_SPEED, CHROMIUM_FLAGS.
   */
  browser: {
    /** null = ephemeral mkdtemp; path = durable vault (~/.xclaw/browser-profiles/default) */
    profileDir: null,
    /** true = --headless (default); false or env XCLAW_BROWSER_HEADED=1 → visible window */
    headless: true,
    /** Inject human reaction/key/mouse delays + bezier paths */
    humanize: true,
    humanizeSpeed: 1.0,
    /** Seed cookies/LS from system Chrome Default on first durable start */
    copySession: false,
    /**
     * M0/M1 MITM — OFF by default. Enable with XCLAW_MITM=true or enabled: true.
     * Supervisor starts mitmdump when enabled; Chrome gets --proxy-server (M2 CA trust later).
     */
    mitm: {
      enabled: false,
      port: 4444,
      confdir: null, // default ~/.xclaw/mitm
      allowlist: [], // empty = all hosts (still redacts secrets in flows.jsonl)
      sslInsecure: true,
    },
  },
  agent: {
    provider: "xai",
    model: "grok-4.3",
    apiKey: null,
    baseUrl: null,
    /**
     * Reasoning effort (xAI grok-4.5/4.6 and peers).
     * effort: "low" | "medium" | "high" | "xhigh"
     *   - xhigh: grok-4.6 / multi-agent; on grok-4.5 coerced to high by default
     *   - omit / enabled-only → provider default (high on 4.5)
     * coerceXhigh: true (default) maps xhigh→high when model lacks xhigh (e.g. 4.5)
     * coerceXhighFor45: alias of coerceXhigh (compat)
     */
    reasoning: {
      enabled: false,
      effort: null,
      coerceXhigh: true,
      coerceXhighFor45: true,
    },
    /** Post-turn follow-up chips */
  suggestions: {
    enabled: true,
    max: 3,
    minScore: 0.35,
    /** Hide chips when turn looks complete */
    suppressOnClose: true,
    closureMinConfidence: 0.6,
    /** If closed, still offer a single commit chip */
    /** true = always when closed; false = never; "auto" = only if git dirty */
    closedAllowCommitChip: "auto",
    skipGitInspect: false,
    gitTimeoutMs: 2500,
    /** Feedback learning priors */
    priorCtr: 0.15,
    priorStrength: 8,
    userMinShown: 3,
    /** telegram | plain | both */
    telegramMode: "keyboard",
  },
  maxTurns: 15,
    /**
     * Tool-loop detection (OpenClaw-ported).
     * Env: XCLAW_LOOP_GUARD=off | XCLAW_LOOP_GUARD_GLOBAL=60 | _CRITICAL | _WARNING
     * Profiles adjust thresholds (lab higher, prod tighter).
     */
    loopGuard: {
      enabled: true,
      historySize: 30,
      warningThreshold: 10,
      criticalThreshold: 20,
      /** Alias accepted: circuitBreaker */
      globalCircuitBreakerThreshold: 30,
      circuitBreaker: 30,
      detectors: {
        genericRepeat: true,
        knownPollNoProgress: true,
        pingPong: true,
        argumentChurn: true,
      },
    },
  },
  sandbox: {
    enabled: true,
    readOnly: false,
    allowPaths: [],
  },
  slo: {
    jobWallP99Ms: 120000,
    computerUp: true,
    approvalPendingMax: 10,
    approvalAgeP99Ms: 300000,
  },
  jobs: {
    groundHard: false,
    claimsRequireEvidence: false,
    requireStructuredClaims: false,
    structuredClaimsOnTags: ["campaign", "long", "campaign-v2"],
  },
  // Long-run objectives (docs/LONGRUN.md). requireChecked is the Trust
  // Sprint fail-closed completion gate: a mission with NO trusted
  // deterministic checks (api- or runtime-derived) cannot silently close —
  // it pauses awaiting the owner's explicit approve. Set false to restore
  // the pre-3.153 narrated-completion behavior.
  objectives: {
    maxSegments: 40,
    progressEverySegments: 5,
    requireChecked: true,
    deriveChecks: true, // derive npm test/lint (etc.) checks at mission start
    autoResume: true, // boot: auto-resume objectives interrupted by a crash
    autoResumeMax: 3,
  },
  cost: {
    dailySoftUsd: 5,
    dailyHardUsd: 15,
    perJobUsd: 1,
    pauseQueueOnHard: true,
  },
  // B1 persistent repo intelligence — incremental per-repo index + brief
  intel: {
    tool: true, // register xclaw_repo_intel in every agent run
  },
  // A1 operational ledger — the durable black box (docs/LEDGER.md)
  ledger: {
    enabled: true,
    retentionDays: 90,
    maxPerMin: 0, // 0 = no sampling; >0 caps ok-read tool entries per minute
  },
  tokens: {
    enabled: true,
    mode: "auto",
    charsPerToken: 4,
    proseCharsPerToken: 4,
    codeCharsPerToken: 2.5,
    adaptive: true,
    overheadPerMessage: 4,
    replyPrimer: 3,
    probeOnStart: true,
    calibrateOnStart: false,
    ledger: true,
    slimSkillsAfterTurn: null,
    truncate: {
      enabled: true,
      maxChars: 4000,
      headChars: 2800,
      tailChars: 800,
      maxLineLength: 500,
      notice: true,
      perTool: {
        bash: { maxChars: 6000, headChars: 4000, tailChars: 1200 },
        browser: { maxChars: 5000, headChars: 3500, tailChars: 1000 },
        file_read: { maxChars: 8000, headChars: 5000, tailChars: 1500 },
        file_write: { maxChars: 2000, headChars: 1500, tailChars: 400 },
      },
    },
    cacheBreakpoints: {
      enabled: true,
      mode: "auto",
      ttl: "ephemeral",
      multipart: false,
      breakpoints: {
        afterBase: true,
        afterMemory: true,
        afterSkills: true,
      },
    },
    eviction: {
      enabled: true,
      policy: "hybrid",
      maxMessages: 40,
      maxChars: 120000,
      toolMaxChars: 2000,
      protectRecent: 4,
      pairAware: true,
      insertSummary: true,
      maxHistoryTokens: 12000,
      maxToolResultChars: 1500,
      compactTools: true,
      lru: {
        mode: "size_weighted",
        sizeTransform: "log",
        dynamic: {
          enabled: true,
          strategy: "pressure_skew",
          ema: 0.3,
          wSizeMin: 0.25,
          wSizeMax: 0.9,
          dual: {
            enabled: true,
            mode: "blend",
            alphaFast: 0.5,
            alphaSlow: 0.15,
            deadband: 0.05,
            betaMin: 0.25,
            betaMax: 0.85,
            confirmTurns: 2,
            adaptive: {
              enabled: true,
              stressPressure: 1.05,
              nearPressure: 0.95,
              stressAfter: 2,
              stressDeadband: 0.02,
              stressAlphaFast: 0.7,
              stressConfirmTurns: 1,
              nearDeadband: 0.03,
              nearAlphaFast: 0.55,
            },
          },
        },
      },
    },
  },
  connected: {
    refreshScheduler: true,
    refreshIntervalMs: 900000,
    encryptionKey: null,
  },
  image: {
    models: null,
    endpoints: null,
    responseFormat: "b64_json",
  },
  office: {
    /** e.g. "socket,host=127.0.0.1,port=2002" — optional UNO listener */
    unoUrl: "",
    /** shared profile dir when using UNO, e.g. "/tmp/xclaw-lo-daemon" */
    userInstallation: "",
  },
  skills: {
    proposeOnFail: true,
    proposeOnSuccess: true,
    proposeOnSuccessMinTools: 2,
    enabled: true,
    maxChars: 6000,
  },
  memory: {
    enabled: true,
    maxChars: 8000,
    preferenceWriteBack: true,
  },
  /** S0–S3 swarm */
  swarm: {
    /**
     * Decompose engine (ADR 0004 unification — formerly the isolated
     * swarmExt module; that legacy config key is still honored):
     * goal → DAG → parallel sub-agents on the REAL risk-gated tool
     * router → merge → receipt, at /swarm/goals. In-process queue/store,
     * zero external deps. OFF by default.
     */
    decompose: {
      enabled: false,
      /** optional model override; defaults to cfg.agent.model via provider routing */
      model: null,
      /** operator caps over the vendored config (vendor default was 300/300) */
      maxSubAgents: 25,
      maxConcurrent: 8,
      /**
       * Bridge to xclaw's REAL tool router for sub-agents (tool-bridge.mjs).
       * Autonomous sub-agents can never pend for approval, so every call is
       * risk-gated FAIL-CLOSED: assessRisk tier must be ≤ autoApproveMaxTier
       * ("low" = reads + provably read-only exec + workspace writes; risky and
       * critical are denied with a typed error). `allow` narrows which tools
       * are advertised (null = curated DEFAULT_ALLOW); `alwaysAllow` bypasses
       * the tier gate by name (default: web_search/web_fetch — research
       * primitives whose name-family would classify egress→risky).
       */
      tools: {
        enabled: true,
        autoApproveMaxTier: "low",
        allow: null,
        alwaysAllow: null,
      },
    },
    enabled: true,
    subagentTimeoutMs: 300_000,
    maxParallel: 3,
    maxChildrenPerRun: 8,
    onDepFail: "skip-downstream",
    /** Extra attempts after first failure for SPAWN_FAILED / TIMEOUT */
    nodeRetries: 2,
    /** exponential | full | equal | decorrelated | none */
    retryStrategy: "decorrelated",
    retryBaseMs: 500,
    retryCapMs: 15_000,
    respectRetryAfter: true,
    retryAfterJitterRatio: 0.1,
    /** S3–S4 safe merge */
    mergeEnabled: true,
    /** prod: false — leave patches pending_approval */
    autoMerge: false,
    /** lab/dev only convenience if autoMerge not set */
    autoMergeLab: false,
    mergeRequireVerify: true,
    mergeRequireCriticPass: false,
    cleanupWorktreeAfterMerge: false,
    /** S4: block merge if main has unstaged/staged changes */
    mergeRequireCleanMain: false,
    /** S4: git apply --index (stricter; stages on apply) */
    mergeUseIndex: false,
    /** Structured majority vote on research JSON ballots */
    voteEnabled: true,
    voteRoles: ["research"],
    voteMinBallots: 2,
    voteMinShare: 0.5,
    /** null = union of all ballot keys */
    voteFields: null,
    /** none|first|last|lexical|lexical_desc|confidence|prefer|random */
    voteTieBreak: "confidence",
    votePreferValues: null,
    voteRoleWeights: null,
    /** After merge approve, commit with XClaw signature (GitHub history) */
    commitAfterMerge: true,
    commitSubject: null,
  },
  git: {
    commitAfterMerge: true,
    alwaysTrailers: true,
    installCommitHook: true,
    commitGeneratedWith: "Generated with [XClaw](https://x.ai/)",
    commitCoAuthoredBy: "Co-Authored-By: XClaw <noreply@xclaw.local>",
    commitExtraTrailers: [],
    commitAuthor: null,
  },
  /** Grok / xAI account login (Option B) */
  auth: {
    xai: {
      clientId: "xclaw-cli",
      authHost: "https://auth.x.ai",
      accountsHost: "https://accounts.x.ai",
      apiHost: "https://api.x.ai",
    },
  },
  /**
   * Live Voice Agents — use Grok seat Voice when available
   */
  voice: {
    enabled: true,
    defaultPreset: "personal_assistant",
    provider: "seat",
    seatVoice: "ara",
    speakWhileTools: true,
    bargeInMutesSpeechOnly: true,
    ollamaUrl: "http://127.0.0.1:11434",
    ollamaModel: "qwen2.5:7b",
    stt: { provider: "auto" },
    tts: { provider: "seat" },
    realtime: { enabled: false },
  },
  /** R4 proactive autonomy */
  autonomy: {
    /** off | supervised | lab | full — see autonomy-policy.mjs */
    level: "lab",
    heartbeat: {
      enabled: false,
      everyMs: 1_800_000, // 30m
      prompt:
        "Heartbeat: briefly check for urgent owner tasks. If nothing needs action, reply with exactly: HEARTBEAT_OK",
      silenceOk: true,
      delivery: { channel: null, to: null },
    },
    quietHours: {
      enabled: false,
      startHour: 23,
      endHour: 7,
      tzOffsetMinutes: 0,
    },
    maxUsdPerDay: null,
  },
  channels: {
    slack: {
      enabled: false,
      botToken: "",
      appToken: "",
      socketMode: false,
      channelIds: [],
      pollIntervalMs: 4000,
      heartbeatMs: 90000,
    },
    email: {
      enabled: false,
      pollIntervalMs: 30000,
      allowFrom: null,
      imap: { host: "", port: 993, user: "", pass: "", tls: true, mailbox: "INBOX" },
      smtp: { host: "", port: 465, user: "", pass: "", tls: true, from: "" },
    },
    webchat: {
      enabled: true,
    },
    telegram: {
      enabled: false,
      token: null,
      allowedChatIds: null,
      /** poll | webhook */
      transport: "poll",
      webhookUrl: null,
      webhookSecret: null,
      /** Owner chat id for pairing/approval inline buttons */
      ownerChatId: null,
      /** Only one process may consume updates */
      singleWriter: true,
      /** Long-poll tuning */
      pollTimeoutSec: 30,
      pollLimit: 100,
      /** Long reply: chunk under 4096; hard total cap */
      chunkMax: 4000,
      maxReplyChars: 12000,
      /** Progressive replies via editMessageText */
      stream: {
        enabled: true,
        minEditIntervalMs: 1200,
        showTools: true,
        partialText: true,
      },
      /** Voice-note replies (local TTS: espeak-ng / piper) */
      voiceOut: {
        enabled: false,
        mode: "on_request",
        maxChars: 400,
        caption: true,
      },
      /** Group / forum topic policy */
      groups: {
        policy: "mention",
        requireMention: true,
        allowedGroupIds: null,
        topics: {},
      },
    },
    discord: {
      enabled: false,
      token: null,
      allowedChannelIds: null,
    },
  },
  /** Transient HTTP/network retries (provider + computer client). */
  shutdown: {
    drainMs: 15_000,
  },
  readiness: {
    /** false = gateway /ready even if computer still starting (low-setup) */
    requireComputer: false,
    maxQueued: 100,
    strictQueue: false,
  },
  queue: {
    concurrency: 1, // 1–3
  },
  eval: {
    cron: {
      enabled: true,
      everyMs: 86_400_000, // 24h
      tag: null, // all cases
    },
    spend: {
      windowRuns: 50,
      maxUsdPerWindow: null, // set e.g. 5.0 to alert
      maxRunsPerWindow: null,
      alert: true,
    },
  },
  retry: {
    retries: 3,
    baseMs: 200,
    maxDelayMs: 30_000,
    /** full | equal | decorrelated | none */
    strategy: "full",
    respectRetryAfter: true,
    retryAfterJitterRatio: 0.1,
    log: true,
  },
  security: {
    /** R3: /link codes only in DMs */
    linkDmOnly: true,
    allowedTools: [],
    // Reached when a config sets autoApprove:false without a profile. Kept in
    // step with the prod profile's list by test/mutating-tools-approval.test.mjs.
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
      "xclaw_spawn_agent",
      "xclaw_swarm_run",
      "xclaw_swarm_merge_approve",
      "xclaw_swarm_merge_reject",
    ],
    /** Phase 7.4: safer default — set true only in trusted envs */
    bindSystemRunPlan: true,
    autoApprove: true,  // low-setup; prod profile sets false
    /** Max wait for human approval before slaAction */
    approvalSlaMs: 300_000,
    approvalSlaAction: "deny",

    /** always | risky | never */
    approvalPolicy: "risky",
    /** Never require approval even under risky policy */
    safeAuto: [
      "xclaw_file_read",
      "file_read",
      "read_file",
      "xclaw_file_list",
      "list_dir",
      "glob",
      "grep",
      "web_fetch",
      "web_search",
      "file_type",
      "markitdown",
      "host_capabilities",
      "ocr",
    ],
  },
  mcp: {
    servers: [],
  },
  /** Lifecycle hook system (docs/HOOKS.md) */
  hooks: {
    enabled: true,
    /** per-category kill switches, e.g. { pre_process: false } */
    categories: {},
    /** per-hook execution budget */
    timeoutMs: 2000,
    /** log hook executions to stdout */
    log: true,
    /** ESM modules exporting register(manager); tier is OPERATOR-assigned:
     *  [{ path: "/abs/my-hooks.mjs", tier: "trusted" }] (default tier: user) */
    modules: [],
  },
  providers: {
    routes: {
      "grok-": "xai",
      "gpt-": "openai",
      "claude-": "anthropic",
      default: "openai",
    },
  },
  paths: {},
};


export const CONFIG_DIR_NAME = ".xclaw";
export const CONFIG_FILE_NAME = "xclaw.json";
