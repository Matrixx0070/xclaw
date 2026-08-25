/**
 * XClaw agent loop — Phase 5
 * model ↔ tools + skills/memory context
 */
import {
  createComputerClient,
  toOpenAITools,
  formatToolResult,
} from "./computer-client.mjs";
import { ensureComputer } from "../computer/ensure.mjs";
import {
  evaluateTurnPreflight,
  planPairingBackfill,
  computeStopReason,
  terminalStatus,
  planFinalAnswerRescue,
  parseToolCallArgs,
} from "./loop-stages.mjs";
import { createProvider } from "./provider.mjs";
import { createFailoverProvider } from "../providers/failover-router.mjs";
import {
  createRoleRouter,
  selectRole,
  resolveRoleToolPack,
  resolveRoleEffort,
} from "../providers/role-router.mjs";
import { runVerifyPass } from "../providers/verify-pass.mjs";
import { buildTurnSuggestions } from "./suggestions.mjs";
import {
  beginToolTraceEntry,
  finalizeToolTraceEntry,
  resetToolTraceSeq,
} from "./tool-trace.mjs";
import {
  inferGoal,
  buildTurnState,
  formatBlockedReply,
} from "./turn-state.mjs";
import { createLoopGuard } from "./loop-guards.mjs";
import { guardHighRiskReceipt } from "./high-risk-receipt.mjs";
import { createCostGovernor } from "./cost-governor.mjs";
import { estimateUsdFromUsage } from "../tokens/cost-governor.mjs";
import { recordToolTokens } from "./token-cache-metrics.mjs";
import { runHallucinationCanary } from "./hallucination-canary.mjs";
import { softCanaryRecover } from "./canary-recover.mjs";
import { incCanaryUngrounded } from "./canary-metrics.mjs";
import { stampCostBlock } from "./cost-receipt.mjs";
import { getSharedApprovalGate } from "../security/approvals.mjs";
import { checkLoopCostBudget, checkJobCostBudget } from "../tokens/loop-cost-check.mjs";
import { saveAgentRun } from "./run-store.mjs";
import { partitionToolCalls, runToolBatches, resolveMaxParallel } from "./tool-concurrency.mjs";
import {
  appendTranscript,
  loadTranscriptHistory,
} from "../sessions/transcript.mjs";
import { revalidatePlan, isExecTool } from "../security/system-run-plan.mjs";
import { createRunBudget } from "./run-budget.mjs";
import { compileToolFilter, filterToolDefs, missingAllowedTools } from "./tool-filter.mjs";
import { resolveProviderRoute, resolveProviderRouteAsync } from "../providers/router.mjs";
import { createSpawnTool, spawnSubagent } from "../agents/spawn.mjs";
import { createSwarmRunTool } from "../agents/swarm-run.mjs";
import { createMergeTools } from "../agents/swarm-merge.mjs";
import {
  loadAllSkills,
  loadMemoryFiles,
  buildContextSections,
} from "../skills/loader.mjs";
import { loadDurableMemoryFile } from "../memory/durable.mjs";
import { createRecallTool, createForgetTool } from "../memory/recall.mjs";
import { createRepoIntelTool } from "../intel/intel-tool.mjs";
import { estimateRequestTokens, resolveTokenizer } from "../tokens/count.mjs";
import { createUsageTracker, defaultLedgerPath } from "../tokens/usage-tracker.mjs";
import {
  buildCacheableSystemPrompt,
  aggregateCacheStats,
  cachingRecommendations,
} from "../tokens/cache-strategy.mjs";
import { buildSystemMessageWithBreakpoints } from "../tokens/cache-breakpoints.mjs";
import {
  optimizePrefix,
  assertPrefixStable,
  ensurePrefixStable,
  makeEphemeralNotice,
  defaultCacheOptimizePolicy,
} from "../tokens/prefix-optimize.mjs";
import { evictMessages, evictionOptsFromConfig } from "../tokens/eviction.mjs";
import { measureContextPressure, pressureToEvictionTweaks } from "../tokens/pressure.mjs";
import {
  compactMessages,
  compactionOptsFromConfig,
} from "../tokens/compaction.mjs";
import { analyzeCacheByTool } from "../tokens/cache-by-tool.mjs";
import { truncateToolResult, truncationOptsFromConfig } from "./truncate.mjs";
import { guardToolPaths } from "../security/sandbox.mjs";
import { policyDecision } from "../security/decisions.mjs";
import { guardToolEgress } from "../security/egress.mjs";
import { registerSession, unregisterSession } from "./session-control.mjs";
import { makeToolMessage, freezeRankSize } from "../tokens/rank-size.mjs";
import { createAllLocalTools, localToolsAsOpenAI, executeLocalTool, localToolNames } from "../tools/registry.mjs";
import { createToolRouter } from "../tools/router.mjs";
import { createAgentMcpTools } from "./mcp-tools.mjs";
import { getSharedHookManager } from "../hooks/manager.mjs";
import { createLedger, slimToolTraceEntry } from "../ops/ledger.mjs";
import { inferEffects } from "../agents/swarm-receipt.mjs";
import { afterBrowserToolTruth } from "../browser/truth.mjs";
import { beforeNavigate, beforeInput } from "../browser/hooks.mjs";
import { resolveRole } from "../browser/role-binding.mjs";
import { stripClaimsBlock } from "./claims-scaffold.mjs";

// Router phrasings that mean "this tool name is not routable" — a hallucinated
// tool. The router THROWS these ("Unknown tool: X" plane-fallthrough, "No
// adapter for X (plane=local)", "Unknown local/MCP tool", "No MCP adapter") or
// returns them ("No agent handler for X"). It does NOT emit them for a real tool
// on an unavailable plane ("computer plane unavailable"), so matching this on an
// errored call is an alias-safe, engine-agnostic signal that the model invented
// a tool that does not exist.
const UNROUTABLE_TOOL_RE =
  /\b(?:unknown (?:tool|local tool|mcp tool)|no (?:adapter|mcp adapter|agent handler))\b/i;

/**
 * Assistant message content → plain text. Providers may return a string or a
 * parts array ({type:"text", text} / {text}); empty/unknown parts collapse to "".
 */
export function normalizeAssistantContent(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === "string" ? p : p?.text ?? ""))
      .filter(Boolean)
      .join("\n");
  }
  return String(content);
}

// Grounding scaffold rules live in their own module so the TUI can share them
// without importing the loop. Re-exported: the raw finalText is kept for
// internal consumers, only the presented `text` is cleaned.
export { stripClaimsBlock };

const BASE_SYSTEM_PROMPT = `You are XClaw, a personal AI assistant with a real computer.
When stating what you did, prefer a final structured block:
\`\`\`json
{"claims":["short factual claim"],"evidence_ids":["ev_1 or tool name"]}
\`\`\`
Only claim actions supported by tool results.

You can run shell commands, read/write files, and control a browser via tools.

Rules:
- Be concise. Prefer small, correct tool calls.
- If a task is done, answer without more tools.
- If a tool fails, try a different approach once; do not retry the exact same call endlessly.
- Grounding: only assert facts that came from tool results in this turn. If a file or path was not read or listed by a tool, say you do not know — never invent contents or paths.
- Prefer verify-by-tool: after writing a file, re-read or list to confirm when accuracy matters.
- When project memory or skills are provided below, follow them.`;

/**
 * @param {object} options
 * @param {string} options.userMessage
 * @param {object} options.cfg
 * @param {string} [options.workingDir]
 * @param {AbortSignal} [options.signal]
 * @param {(event: object) => void} [options.onEvent]
 */
export async function runAgentLoop(options) {
  const {
    userMessage,
    cfg,
    workingDir = process.cwd(),
    signal: signalOpt,
    onEvent: onEventCb = () => {},
    /** Prefer SSE token streaming when provider supports chatStream */
    stream: preferStream = false,
    userId,
    channel,
    chatId,
    /** Durable conversation id for transcript load/save */
    chatSessionId = null,
    /** Prior conversation turns: [{role, content}, ...] — excludes system */
    history = [],
    /** Override the maxTurns final-answer rescue instruction (orchestrated
     *  segments want the mission state block, not a user-facing answer) */
    rescuePrompt = null,
  } = options;
  const transcriptId =
    chatSessionId || options.conversationId || chatId || null;

  // Kill-switch: every loop is registered so `xclaw stop-all` / killSession aborts it
  const sessionKey =
    transcriptId ||
    options.sessionId ||
    `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const registered = registerSession(sessionKey, {
    label: String(userMessage || "").slice(0, 80) || sessionKey,
  });
  // Prefer caller signal; also abort when session kill fires
  let signal = signalOpt;
  if (signal && registered.signal) {
    const merged = new AbortController();
    const forward = () => {
      try {
        merged.abort(signal.reason || registered.signal.reason || new Error("aborted"));
      } catch {
        /* ignore */
      }
    };
    if (signal.aborted || registered.signal.aborted) forward();
    else {
      signal.addEventListener("abort", forward, { once: true });
      registered.signal.addEventListener("abort", forward, { once: true });
    }
    signal = merged.signal;
  } else {
    signal = signal || registered.signal;
  }

  const eventLog = [];
  const onEvent = (e) => {
    eventLog.push(e);
    onEventCb(e);
  };

  // Lifecycle hook manager (cfg.hooks / docs/HOOKS.md). Injectable for tests;
  // every executeAll below is failure-isolated — a broken hook never crashes
  // the run.
  const hooks = options.hookManager || getSharedHookManager(cfg);

  const maxTurns = cfg.agent?.maxTurns ?? 15;
  // S3 (Master Evolution Directive): the turn budget is a SEGMENT boundary,
  // not a mission boundary. On the default path the loop checkpoints at each
  // maxTurns multiple and continues — up to a bounded total — instead of
  // abandoning unfinished work ("maximum turns reached" is never "mission
  // complete"). Resource limits (cost governor, run budget) remain the real
  // stops and are checked every turn. Orchestrators that manage their own
  // segmentation (objective segments, spawn children, jobs, missions,
  // sub-runs) pass continuation:false and keep the single-segment contract.
  const continuationEnabled =
    options.continuation !== false && cfg.agent?.continueOnMaxTurns !== false;
  const totalTurnCap = continuationEnabled
    ? Math.max(maxTurns, cfg.agent?.maxTotalTurns ?? maxTurns * 4)
    : maxTurns;
  const runBudget = createRunBudget(cfg);
  const skillsEnabled = cfg.skills?.enabled !== false;
  const memoryEnabled = cfg.memory?.enabled !== false;

  // Outer try ensures kill-switch unregister even if setup throws
  try {
  const computer = createComputerClient(cfg);
  const useFailover = cfg.router?.enabled !== false;
  // Injected provider (tests / embedders) skips router resolution entirely
  let provider = options.provider || undefined;
  let route;
  let roleRouterMeta = null;
  const onRetryProvider = (info) => {
    onEvent({
      type: "retry",
      target: "provider",
      attempt: info.attempt,
      retries: info.retries,
      delayMs: info.delayMs,
      strategy: info.strategy,
      message: String(info.error?.message || info.error || ""),
    });
  };

  // Role router (draft / act / verify) when configured
  if (!provider) try {
    const rr = await createRoleRouter(cfg, { onEvent, onRetry: onRetryProvider });
    if (rr.enabled && rr.provider) {
      provider = rr.provider;
      roleRouterMeta = rr.roleBundle;
      route = rr.roleBundle?.byRole?.act?.route || {
        provider: provider.providerName,
        model: provider.model,
        modelRef: provider.modelRef,
        hasKey: true,
        baseUrl: provider.baseUrl,
      };
      onEvent({
        type: "router",
        phase: "ready",
        mode: "roles",
        roles: provider.roles,
      });
    }
  } catch (err) {
    onEvent({
      type: "router",
      phase: "roles_error",
      message: String(err.message || err),
    });
  }

  if (!provider && useFailover) {
    try {
      const fo = await createFailoverProvider(cfg, {
        model: process.env.XCLAW_MODEL || cfg.agent?.model,
        onEvent,
        onRetry: onRetryProvider,
      });
      provider = fo.provider;
      route = fo.clients[0]?.route || {
        provider: provider.providerName,
        model: provider.model,
        modelRef: provider.modelRef,
        hasKey: true,
        baseUrl: provider.baseUrl,
      };
      onEvent({
        type: "router",
        phase: "ready",
        mode: "failover",
        primary: fo.primary,
        chain: fo.chain,
      });
    } catch (err) {
      // Fall back to single-provider path
      onEvent({
        type: "router",
        phase: "fallback_single",
        message: String(err.message || err),
      });
      route = await resolveProviderRouteAsync(cfg, {
        model: process.env.XCLAW_MODEL || cfg.agent?.model,
        provider: process.env.XCLAW_PROVIDER || cfg.agent?.provider,
      });
      provider = createProvider({
        apiKey:
          route.apiKey ||
          cfg.agent?.apiKey ||
          process.env.OPENAI_API_KEY ||
          process.env.XCLAW_API_KEY ||
          process.env.ANTHROPIC_API_KEY ||
          process.env.CLAUDE_CODE_OAUTH_TOKEN ||
          process.env.ANTHROPIC_AUTH_TOKEN,
        baseUrl:
          cfg.agent?.baseUrl ||
          process.env.XCLAW_API_BASE ||
          route.baseUrl,
        model: route.model || process.env.XCLAW_MODEL || cfg.agent?.model || "gpt-4o-mini",
        provider: route.provider,
        api: route.api,
        cfg,
        onRetry: onRetryProvider,
        convId: sessionKey,
        sessionId: sessionKey,
        conversationId: transcriptId || sessionKey,
      });
      provider.providerName = route.provider;
    }
  }

  if (!provider) {
    route = await resolveProviderRouteAsync(cfg, {
      model: process.env.XCLAW_MODEL || cfg.agent?.model,
      provider: process.env.XCLAW_PROVIDER || cfg.agent?.provider,
    });
    provider = createProvider({
      apiKey:
        route.apiKey ||
        cfg.agent?.apiKey ||
        process.env.OPENAI_API_KEY ||
        process.env.XCLAW_API_KEY ||
        process.env.ANTHROPIC_API_KEY ||
        process.env.CLAUDE_CODE_OAUTH_TOKEN ||
        process.env.ANTHROPIC_AUTH_TOKEN,
      baseUrl:
        cfg.agent?.baseUrl ||
        process.env.XCLAW_API_BASE ||
        route.baseUrl,
      model: route.model || process.env.XCLAW_MODEL || cfg.agent?.model || "gpt-4o-mini",
      provider: route.provider,
      api: route.api,
      cfg,
      onRetry: onRetryProvider,
      convId: sessionKey,
      sessionId: sessionKey,
      conversationId: transcriptId || sessionKey,
    });
    provider.providerName = route.provider;
  }

  if (!route && provider) {
    route = {
      provider: provider.providerName || "unknown",
      model: provider.model,
      modelRef: provider.modelRef || provider.model,
      hasKey: true,
      baseUrl: provider.baseUrl,
    };
  }
  const hasAnyKey =
    Boolean(route?.hasKey) ||
    Boolean(
      cfg.agent?.apiKey ||
        process.env.OPENAI_API_KEY ||
        process.env.XCLAW_API_KEY ||
        process.env.ANTHROPIC_API_KEY ||
        process.env.CLAUDE_CODE_OAUTH_TOKEN ||
        process.env.ANTHROPIC_AUTH_TOKEN ||
        process.env.XAI_API_KEY
    );
  if (!provider) {
    throw new Error(
      "No LLM provider initialized. Set agent.model and API keys, or router.roles.act"
    );
  }
  if (
    !(provider.baseUrl || "").includes("localhost") &&
    !(provider.baseUrl || "").includes("127.0.0.1") &&
    !hasAnyKey
  ) {
    throw new Error(
      "No API key / OAuth token. Set agent.apiKey, XAI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, or run: xclaw models auth login --provider anthropic --method oauth"
    );
  }

  onEvent({ type: "lifecycle", phase: "start" });

  // Skills + memory (Phase 5)
  let skills = [];
  let memoryFiles = [];
  if (skillsEnabled || memoryEnabled) {
    try {
      if (skillsEnabled) {
        skills = await loadAllSkills({
          configDir: cfg.paths?.configDir,
          cwd: workingDir,
          cfg,
        });
      }
      if (memoryEnabled) {
        memoryFiles = await loadMemoryFiles(workingDir);
        try {
          // Durable local MEMORY.md is lower priority than repo XCLAW.md.
          // Put it first so project files stay last (win model attention)
          // and survive maxMemoryChars truncation from the front.
          const durable = await loadDurableMemoryFile(cfg, workingDir);
          if (durable) memoryFiles = [durable, ...memoryFiles];
        } catch {
          /* */
        }
        try {
          // S7: owner preferences were WRITE-ONLY — extractPreferenceHints
          // recorded them after every job and nothing ever read them back.
          // Memory that never changes behavior is not memory. Lowest
          // priority (before durable), opt out via memory.preferences:false.
          if (cfg.memory?.preferences !== false) {
            const { loadPreferences } = await import("../memory/preferences.mjs");
            const prefs = await loadPreferences(cfg);
            if (prefs && prefs.trim() && prefs.trim().split("\n").length > 1) {
              memoryFiles = [
                {
                  path: "preferences.md",
                  name: "preferences.md",
                  body: prefs.trim(),
                  content: prefs.trim(),
                  source: "preferences",
                },
                ...memoryFiles,
              ];
            }
          }
        } catch {
          /* preferences are additive — never block the run */
        }
      }
      onEvent({
        type: "context",
        skills: skills.map((s) => s.name),
        memory: memoryFiles.map((m) => m.path),
      });
    } catch (err) {
      console.error(`[xclaw] context load warning:`, err.message);
    }
  }

  const contextSections = buildContextSections({
    skills,
    memoryFiles,
    maxSkillChars: cfg.skills?.maxChars ?? 6000,
    maxMemoryChars: cfg.memory?.maxChars ?? 8000,
    progressive: cfg.skills?.progressive,
    inlineMaxChars: cfg.skills?.inlineMaxChars,
  });
  // Stable prefix for provider prompt caching (xAI cached_tokens, etc.)
  const systemContent = buildCacheableSystemPrompt({
    basePrompt: BASE_SYSTEM_PROMPT,
    contextSections,
    dynamicNotes: [
      ...(Array.isArray(cfg.agent?.systemNotes) ? cfg.agent.systemNotes : []),
      ...(options.systemNotes
        ? Array.isArray(options.systemNotes)
          ? options.systemNotes
          : [options.systemNotes]
        : []),
    ].filter(Boolean),
  });

  // Cost governor pre-check — refuse before computer/session when hard-capped
  try {
    const { checkLoopCostBudget: checkCostBudget } = await import("../tokens/loop-cost-check.mjs");
    const budget = await checkCostBudget(cfg);
    if (!budget.ok) {
      onEvent({
        type: "cost",
        phase: "blocked",
        spentUsd: budget.spentUsd,
        message: budget.message,
      });
      throw new Error(budget.message || "cost hard cap exceeded");
    }
    if (budget.soft) {
      onEvent({
        type: "cost",
        phase: "soft_warning",
        spentUsd: budget.spentUsd,
        message: budget.message,
      });
    }
  } catch (e) {
    if (String(e?.message || e).includes("hard cap") || String(e?.message || "").includes("Hard daily")) {
      throw e;
    }
    /* governor optional if module/fs fails */
  }

  // Computer session
  const ready = await ensureComputer(cfg, { log: cfg.computer?.logEnsure !== false });
  if (!ready.ok) {
    throw new Error(ready.error || "Computer server is not available");
  }
  const sessionId = await computer.createSession(workingDir);
  onEvent({ type: "computer", phase: "session", sessionId });

  // Optional run-scoped tool allowlist (cfg.agent.allowTools): narrows which
  // tools this run advertises AND dispatches. Missions use it to scope agents
  // to code work; approval gate/hooks/sandbox still apply to what remains.
  const effectiveAllowTools =
    cfg.agent?.allowTools ?? resolveRoleToolPack(cfg) ?? undefined;
  const toolFilter = compileToolFilter(effectiveAllowTools);

  let tools;
  try {
    const computerTools = await computer.listTools(sessionId);
    tools = toOpenAITools(computerTools);
    // Local tools (not on computer server)
    const spawnTool = createSpawnTool({
      cfg,
      workingDir,
      signal,
      sessionId: "pending",
      onEvent,
    });
    tools.push({
      type: "function",
      function: {
        name: spawnTool.name,
        description: spawnTool.description,
        parameters: spawnTool.parameters,
      },
    });
    if (cfg.swarm?.enabled !== false) {
      const swarmTool = createSwarmRunTool({
        cfg,
        workingDir,
        signal,
        sessionId: "pending",
        onEvent,
      });
      tools.push({
        type: "function",
        function: {
          name: swarmTool.name,
          description: swarmTool.description,
          parameters: swarmTool.parameters,
        },
      });
      const mergeTools = createMergeTools({
        cfg,
        workingDir,
        signal,
        sessionId: "pending",
        onEvent,
      });
      for (const mt of mergeTools) {
        tools.push({
          type: "function",
          function: {
            name: mt.name,
            description: mt.description,
            parameters: mt.parameters,
          },
        });
      }
    }
    // Local tools (glob/grep/web/media/finance/x/connected)
    var localTools = createAllLocalTools({ workingDir, cfg, computer, sessionId });
    tools.push(...localToolsAsOpenAI(localTools));
    // Cross-session recall (durable memory + receipts)
    if (cfg.memory?.recall !== false) {
      const recallTool = createRecallTool({ cfg, workingDir });
      tools.push({
        type: "function",
        function: {
          name: recallTool.name,
          description: recallTool.description,
          parameters: recallTool.parameters,
        },
      });
    }
    // Memory correction: forget wrong/obsolete durable entries (same gate)
    if (cfg.memory?.recall !== false) {
      const forgetTool = createForgetTool({ cfg, workingDir });
      tools.push({
        type: "function",
        function: {
          name: forgetTool.name,
          description: forgetTool.description,
          parameters: forgetTool.parameters,
        },
      });
    }
    // Persistent repo intelligence (B1) — compounding index for every run
    if (cfg.intel?.tool !== false) {
      const intelTool = createRepoIntelTool({ cfg, workingDir });
      tools.push({
        type: "function",
        function: {
          name: intelTool.name,
          description: intelTool.description,
          parameters: intelTool.parameters,
        },
      });
    }
    // B4: caller-injected local tools (e.g. the swarm blackboard) — same
    // security pipeline as every other tool, dispatched by name before the
    // router.
    for (const t of options.extraTools || []) {
      tools.push({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      });
    }
    // MCP servers (cfg.mcp.servers) — discovered tools join the loop and are
    // dispatched via the Tool Router's agent plane (same security path).
    // Skipped entirely when the run's tool filter can never match an mcp__
    // name: no point connecting/spawning servers whose tools can't be used.
    var mcpTools =
      toolFilter && !toolFilter.allowsPrefix("mcp__")
        ? { enabled: false, toolDefs: [], names: [], close() {} }
        : await createAgentMcpTools({ cfg, onEvent });
    tools.push(...mcpTools.toolDefs);
    if (toolFilter) {
      const before = tools.length;
      const available = new Set(tools.map((t) => t.function?.name).filter(Boolean));
      tools = filterToolDefs(tools, toolFilter);
      // An allowlist entry naming a tool that does not exist was dropped in
      // silence: the model was told it could list directories (xclaw_file_list)
      // while the tool never materialised, and only discovered that mid-turn.
      // Aliases are not a gap, so `x` and `xclaw_x` count as one capability.
      const missingAllowed = missingAllowedTools(toolFilter.patterns, [...available]);
      onEvent({
        type: "tools",
        phase: "filtered",
        allow: toolFilter.patterns,
        before,
        after: tools.length,
        missingAllowed,
      });
      if (missingAllowed.length) {
        onEvent({
          type: "tools",
          phase: "allow_missing",
          missingAllowed,
          message: `allowlisted tool(s) not available this run: ${missingAllowed.join(", ")}`,
        });
      }
    }
    onEvent({
      type: "tools",
      count: tools.length,
      names: tools.map((t) => t.function.name),
    });
  } catch (err) {
    try {
      mcpTools?.close?.();
    } catch {
      /* ignore */
    }
    await computer.destroySession(sessionId).catch(() => {});
    throw new Error(`Failed to list computer tools: ${err.message}`);
  }
  if (typeof localTools === "undefined") localTools = createAllLocalTools({ workingDir, cfg, computer, sessionId });
  const mcpHandlers = {};
  if (mcpTools?.enabled) {
    for (const n of mcpTools.names) {
      mcpHandlers[n] = (args) => mcpTools.callTool(n, args);
    }
  }
  const toolRouter = createToolRouter({
    computer,
    sessionId,
    localTools,
    agentHandlers: mcpHandlers,
    cfg,
    workingDir,
  });



  const harnessNotes = [
    ...(Array.isArray(cfg.agent?.systemNotes) ? cfg.agent.systemNotes : []),
    ...(options.systemNotes
      ? Array.isArray(options.systemNotes)
        ? options.systemNotes
        : [options.systemNotes]
      : []),
  ].filter(Boolean);
  const sysBuilt = buildSystemMessageWithBreakpoints({
    basePrompt: BASE_SYSTEM_PROMPT,
    contextSections,
    dynamicNotes: harnessNotes,
    cfg,
    model: provider.model,
    baseUrl: provider.baseUrl,
    provider: cfg.agent?.provider,
  });
  const optimized = optimizePrefix({
    systemMessage: sysBuilt.message,
    tools,
    maxToolDescriptionChars:
      cfg.tokens?.maxToolDescriptionChars ?? cfg.tools?.maxDescriptionChars ?? null,
  });
  tools = optimized.tools;
  // Per-run set of tool names the ROUTER proved unroutable (hallucinated). The
  // router is the single source of truth for "no such tool"; we flag a name only
  // once its OWN dispatch outcome matches UNROUTABLE_TOOL_RE (see below), which
  // is alias-safe (a blocked `bash` returns "computer plane unavailable", never
  // an unknown-tool error) and engine-agnostic. This feeds the loop guard's
  // unknown-tool detector: a repeated hallucinated name becomes a fast typed
  // CRITICAL stop (threshold 10) instead of waiting for the generic no-progress
  // breaker (~20-30 calls).
  const observedUnknownTools = new Set();
  const prefixHash = optimized.fingerprint.hash;
  const frozenSystem = optimized.systemMessage;
  const cachePolicy = defaultCacheOptimizePolicy(cfg);
  onEvent({
    type: "cache",
    phase: "prefix_ready",
    hash: prefixHash,
    systemChars: optimized.fingerprint.systemChars,
    toolsCount: optimized.fingerprint.toolsCount,
    breakpointMode: sysBuilt.meta?.mode,
    restorePrefixEachTurn: cachePolicy.restorePrefixEachTurn,
  });
  // Conversation threading: prior turns then current user message
  const prior = [];
  if (Array.isArray(history)) {
    for (const m of history) {
      if (!m || typeof m !== "object") continue;
      const role = m.role;
      if (role !== "user" && role !== "assistant" && role !== "tool") continue;
      const content = m.content;
      if (content == null) continue;
      prior.push({ role, content: String(content) });
    }
  }
  // Cap history to avoid unbounded context (configurable)
  const maxHistory = cfg.agent?.maxHistoryMessages ?? 40;
  // Durable transcript load when caller did not pass history. An EXPLICIT
  // empty array means "fresh context, no replay" — objective segments rely
  // on this: their memory is the durable mission state, and silently
  // replaying the prior segment's transcript would reintroduce the
  // context-window dependency the orchestrator exists to remove.
  const historyExplicit = options.history !== undefined;
  if (!historyExplicit && !prior.length && transcriptId && cfg.agent?.persistTranscript !== false) {
    try {
      const loaded = loadTranscriptHistory(cfg, transcriptId, maxHistory);
      for (const m of loaded) prior.push(m);
      if (loaded.length) {
        onEvent({
          type: "context",
          phase: "transcript_load",
          sessionId: transcriptId,
          messages: loaded.length,
        });
      }
    } catch (err) {
      onEvent({
        type: "context",
        phase: "transcript_load_error",
        message: String(err.message || err),
      });
    }
  }
  const priorCapped = prior.length > maxHistory ? prior.slice(-maxHistory) : prior;

  // ── Hook: pre_process — system/trusted hooks may rewrite the incoming
  // message; a system-tier hook may abort the run before any model call.
  let hookAbort = null;
  let effectiveMessage = userMessage;
  {
    const hr = await hooks.executeAll(
      "pre_process",
      {
        message: userMessage,
        sessionKey,
        channel: channel || null,
        userId: userId || null,
        workingDir,
        cfg,
      },
      { mutable: ["message"] }
    );
    if (typeof hr.context.message === "string") effectiveMessage = hr.context.message;
    if (hr.abort) {
      hookAbort = hr.abort;
      onEvent({ type: "hook", phase: "abort", category: "pre_process", message: hookAbort });
    } else if (effectiveMessage !== userMessage) {
      onEvent({ type: "hook", phase: "mutated", category: "pre_process" });
    }
  }

  let messages = [
    optimized.systemMessage,
    ...priorCapped,
    { role: "user", content: effectiveMessage },
  ];
  if (priorCapped.length) {
    onEvent({
      type: "context",
      phase: "history",
      historyMessages: priorCapped.length,
      capped: prior.length > maxHistory,
    });
  }
  onEvent({
    type: "cache",
    phase: "breakpoints",
    ...sysBuilt.meta,
    prefix: optimized.fingerprint,
  });

  // Token counting (real usage + estimates)
  const tokensEnabled = cfg.tokens?.enabled !== false;
  let encodeFn = null;
  if (tokensEnabled) {
    const tok = await resolveTokenizer(cfg, provider.model, { baseUrl: provider.baseUrl });
    encodeFn = tok.encodeFn;
  }
  const tokenCfg = {
    tokens: {
      ...(cfg.tokens || {}),
      mode: encodeFn ? "tiktoken" : (cfg.tokens?.mode === "tiktoken" ? "heuristic" : cfg.tokens?.mode || "heuristic"),
      _encodeFn: encodeFn,
    },
  };
  const ledgerPath =
    cfg.tokens?.ledgerPath ||
    (cfg.tokens?.ledger !== false ? defaultLedgerPath() : null);
  const usageTracker = createUsageTracker({
    enabled: tokensEnabled,
    model: provider.model,
    ledgerPath,
  });
  if (tokensEnabled) {
    const est0 = estimateRequestTokens({
      messages,
      tools,
      model: provider.model,
      cfg: tokenCfg,
    });
    usageTracker.setInitialEstimate(est0);
    onEvent({ type: "tokens", phase: "estimate", ...est0 });
  }

  const guard = createLoopGuard(cfg.agent?.loopGuard || {});
  const costGov = createCostGovernor(cfg, options.job || options.jobState || {});
  const approvalGate = options.approvalGate || getSharedApprovalGate(cfg);
  const toolTrace = [];
  let llmSummarizer; // B2: lazily resolved once per run (undefined = not yet)
  // A1 operational ledger — every finalized trace entry (including denials,
  // which post_tool_use hooks never see) is journaled durably. Best-effort:
  // ledger failures never block the loop.
  const ledger = createLedger(cfg, {
    ids: { sessionId: sessionKey, ...(options.ledgerIds || {}) },
  });
  const recordTrace = (entry) => {
    toolTrace.push(entry);
    ledger.append({
      kind: "tool",
      actor: "agent",
      data: slimToolTraceEntry(entry, { effects: inferEffects([entry]) }),
    });
  };
  resetToolTraceSeq();
  const goal = inferGoal(userMessage);
  let lastPendingApproval = null;
  let loopGuardStop = false;
  // S8 escalate-on-stuck: a stagnation warning routes the next few turns to
  // the "strong" role (when the role router maps one) instead of warning the
  // same stuck model. Decremented per escalated turn.
  let escalateTurnsLeft = 0;
  let toolHaltStop = false; // batch stopped by policy (approval/guard/quota) — run must end, not re-turn
  let lastPolicyDecision = null; // S6b: typed ruling from the last blocking gate
  let aborted = false;
  let finalText = "";
  let turns = 0;
  let dualState = null;
  let lastEvictReport = null;
  let prevWeights = null;
  let naturalStop = false;
  let budgetStop = false;
  let maxTurnsStop = false;
  let stopBlocks = 0;
  const stopBlockCap = Number.isFinite(Number(cfg.hooks?.stopBlockCap))
    ? Number(cfg.hooks.stopBlockCap)
    : 2;

  try {
    if (hookAbort && !finalText) {
      finalText = `Run blocked by hook: ${hookAbort}`;
    }
    // on_stop block cycle: a SYSTEM on_stop hook may veto a clean completion
    // ({abort:"reason"}) — the reason is injected as a user turn and the loop
    // re-enters, at most stopBlockCap times (Claude-Code-style Stop hooks).
    stopCycle: while (true) {
    naturalStop = false;
    for (turns = 0; !hookAbort && turns < totalTurnCap; turns++) {
      if (signal?.aborted) throw new Error("aborted");

      // W2 stage 1 — turn pre-flight (segment boundary, cost governor, daily/
      // job budgets, unattended caps). The stage computes the decision; the
      // side effects (events, checkpoint, notice, flags) stay here so the
      // detectors are testable in isolation (src/agent/loop-stages.mjs).
      const preflight = await evaluateTurnPreflight({
        turns,
        maxTurns,
        totalTurnCap,
        continuationEnabled,
        toolCallCount: toolTrace.length,
        totalTokens: usageTracker.snapshot()?.totalTokens || 0,
        jobSpentUsd: options.jobSpentUsd,
        costStrict: Boolean(cfg?.cost?.strict),
        costGovCheck: (u) => costGov.check(u),
        checkDailyBudget: () => checkLoopCostBudget(cfg),
        checkJobBudget: (spent) => checkJobCostBudget(cfg, spent),
        runBudget,
      });
      if (preflight.segment) {
        onEvent(preflight.segment.event);
        try {
          if (options.sessionId || options.persistRun) {
            await saveAgentRun(cfg, {
              sessionId:
                options.sessionId || options.runId || `run_${Date.now().toString(36)}`,
              workingDir: options.workingDir || process.cwd(),
              model: provider?.model || cfg.agent?.model,
              streamId: options.streamId || null,
              messages,
              toolTrace,
              turns,
              status: "active",
              stopReason: "segment",
              meta: {
                goal:
                  typeof userMessage === "string" ? userMessage.slice(0, 200) : null,
              },
            });
          }
        } catch {
          /* checkpoint is best-effort — the run continues regardless */
        }
        messages.push(makeEphemeralNotice(preflight.segment.noticeText));
      }
      for (const ev of preflight.events) onEvent(ev);
      if (preflight.strictError) throw preflight.strictError;
      if (preflight.stop) {
        onEvent(preflight.stop.event);
        if (preflight.stop.stampCost) {
          try {
            stampCostBlock(options.job || options.jobState || {}, preflight.stop.stampCost);
          } catch { /* */ }
        }
        finalText = finalText || preflight.stop.finalTextFallback;
        if (preflight.stop.flags.aborted) aborted = true;
        if (preflight.stop.flags.budgetStop) budgetStop = true;
        break;
      }

      onEvent({ type: "model", phase: "request", turn: turns + 1 });
      // Re-pin system prefix every turn — highest-leverage cache hit optimization
      // for xAI / OpenAI automatic prefix caching (and Anthropic stable blocks).
      if (cachePolicy.restorePrefixEachTurn !== false) {
        const pinned = ensurePrefixStable(
          messages,
          frozenSystem,
          prefixHash,
          tools
        );
        messages = pinned.messages;
        if (pinned.restored || !pinned.ok) {
          onEvent({
            type: "cache",
            phase: "prefix_restored",
            expected: pinned.expected || prefixHash,
            actual: pinned.actual,
            strippedSystem: pinned.strippedSystem,
          });
        }
      } else {
        const stab = assertPrefixStable(messages, prefixHash, tools);
        if (!stab.ok) {
          onEvent({
            type: "cache",
            phase: "prefix_drift",
            expected: stab.expected,
            actual: stab.actual,
          });
          console.warn(
            `[xclaw] prefix cache drift detected ${stab.expected} → ${stab.actual}`
          );
        }
      }
      // Context / KV eviction: protect system prefix, shed old tool tails
      // Dual-EMA + frozen rank sizes persist across turns via dualState / xclaw_rank_size
      const pressure = measureContextPressure(messages, {
        maxChars: evictionOptsFromConfig(cfg).maxChars,
        maxMessages: evictionOptsFromConfig(cfg).maxMessages,
      });
      onEvent({ type: "cache", phase: "pressure", ...pressure });
      const pressureTweaks = pressureToEvictionTweaks(pressure);
      const evictOpts = {
        ...evictionOptsFromConfig(cfg),
        ...pressureTweaks,
        dualState,
        lastReport: lastEvictReport,
        prevWeights,
      };
      if (evictOpts.enabled && evictOpts.policy !== "none") {
        const { messages: nextMsgs, report } = evictMessages(messages, evictOpts);
        if (report.dualState) dualState = report.dualState;
        if (report.weights) prevWeights = report.weights;
        if (report.lastEvictReport) lastEvictReport = report.lastEvictReport;
        if (report.actions?.length) {
          messages = nextMsgs;
          onEvent({ type: "cache", phase: "eviction", ...report });
        }
      }
      // P0 compaction: reversible tool offload + extractive fold under pressure
      // (B2: folds route through a cheap LLM when configured; error → extractive)
      {
        const cOpts = compactionOptsFromConfig(cfg);
        if (cOpts.enabled) {
          if (llmSummarizer === undefined) {
            const { createLlmSummarizer } = await import("../tokens/summarize.mjs");
            llmSummarizer = createLlmSummarizer(cfg, { onEvent });
          }
          const { messages: compacted, report: cReport } = await compactMessages(
            messages,
            { ...cOpts, pressure, summarizeFn: llmSummarizer || undefined }
          );
          if (!cReport.skipped) {
            messages = compacted;
            onEvent({ type: "cache", phase: "compaction", ...cReport });
          }
        }
      }
      const escalating = escalateTurnsLeft > 0;
      if (escalating) escalateTurnsLeft -= 1;
      const turnRole =
        typeof provider.selectRoleForTurn === "function"
          ? provider.selectRoleForTurn({
              turn: turns,
              forceAct: turns > 0,
              escalate: escalating,
            })
          : null;
      const roleForEffort = turnRole || "act";
      const roleEffort = resolveRoleEffort(roleForEffort, cfg);
      const chatArgs = {
        messages,
        tools,
        // xAI sticky prompt cache — same id → same cache shard
        convId: sessionKey,
        conversationId: transcriptId || sessionKey,
        sessionId: sessionKey,
        ...(turnRole ? { role: turnRole } : {}),
        ...(roleEffort ? { reasoning_effort: roleEffort, effort: roleEffort } : {}),
      };
      // ── Hook: on_request — observers see turn metadata; system tier also
      // gets the live messages array.
      await hooks.executeAll("on_request", {
        turn: turns + 1,
        model: provider.model,
        messageCount: messages.length,
        messages,
        cfg,
      });
      const chatT0 = Date.now();
      const completion =
        preferStream && typeof provider.chatStream === "function"
          ? await provider.chatStream({
              ...chatArgs,
              signal,
              onDelta: (d) => {
                if (d.content) {
                  onEvent({
                    type: "model",
                    phase: "delta",
                    content: d.content,
                    accumulated: d.accumulated,
                    turn: turns + 1,
                  });
                }
              },
            })
          : await provider.chat(chatArgs);
      const assistant = completion.message;
      messages.push(assistant);
      onEvent({
        type: "model",
        phase: "response",
        turn: turns + 1,
        finishReason: completion.finishReason,
        hasTools: Boolean(assistant.tool_calls?.length),
      });
      // ── Hook: on_response — after every model reply
      await hooks.executeAll("on_response", {
        turn: turns + 1,
        finishReason: completion.finishReason || null,
        hasToolCalls: Boolean(assistant.tool_calls?.length),
        content:
          typeof assistant.content === "string" ? assistant.content.slice(0, 2000) : null,
        cfg,
      });

      if (tokensEnabled) {
        // Estimate of messages *before* this assistant message was appended
        const messagesForEstimate = messages.slice(0, -1);
        const est = estimateRequestTokens({
          messages: messagesForEstimate,
          tools,
          model: provider.model,
          cfg: tokenCfg,
        });
        const entry = usageTracker.recordTurn({
          turn: turns + 1,
          usage: completion.usage,
          estimate: est,
          elapsedMs: Date.now() - chatT0,
          modelRef: provider.modelRef || provider.model || null,
        });
        if (entry) {
          // Trust Sprint: feed the PER-RUN governor every turn. Before this,
          // costGov.record() was never called anywhere — .check() compared
          // spend against agent.budget.maxUsd while spentUsd stayed 0
          // forever, so the per-run USD ceiling was inert (audit C#7).
          try {
            const pt = Number(entry.promptTokens) || 0;
            const ct = Number(entry.completionTokens) || 0;
            let usd = 0;
            try {
              usd = estimateUsdFromUsage(
                { prompt_tokens: pt, completion_tokens: ct },
                cfg,
                { modelRef: provider.modelRef || provider.model || null }
              );
            } catch {
              /* rate lookup optional */
            }
            costGov.record({ tokens: pt + ct, usd: usd > 0 ? usd : 0 });
          } catch {
            /* governor best-effort */
          }
          onEvent({
            type: "tokens",
            phase: entry.estimated ? "estimate" : "usage",
            ...entry,
          });
          if (!entry.estimated && entry.promptTokens > 0) {
            const hit =
              entry.cacheHitRate != null
                ? entry.cacheHitRate
                : (entry.cachedTokens || 0) / entry.promptTokens;
            onEvent({
              type: "cache",
              phase: "turn_hit_rate",
              turn: turns + 1,
              cacheHitRate: Math.round(hit * 1000) / 1000,
              cacheHitRatePct: Math.round(hit * 1000) / 10,
              cachedTokens: entry.cachedTokens || 0,
              promptTokens: entry.promptTokens,
            });
          }
        }
      }

      const calls = assistant.tool_calls || [];
      if (!calls.length) {
        finalText = assistant.content || "";
        // Optional verify role pass on final tool-free answer
        if (
          typeof provider.verify === "function" ||
          (provider.roles && (provider.roles.verify || provider.roles.strong))
        ) {
          try {
            const v = await runVerifyPass({
              provider,
              userMessage,
              finalText,
              cfg,
              onEvent,
            });
            if (!v.skipped && (v.replaced || v.appended) && v.finalText) {
              finalText = v.finalText;
              messages.push({
                role: "assistant",
                content: finalText,
                _xclawVerify: true,
              });
            } else if (!v.skipped && v.revise && v.revisedText && !v.replaced && !v.appended) {
              // Soft mode: keep act answer, attach critique in event only
              onEvent({
                type: "router",
                phase: "verify_suggest",
                suggestion: v.revisedText.slice(0, 2000),
              });
            } else if (!v.skipped && v.ok) {
              onEvent({ type: "router", phase: "verify_ok" });
            }
          } catch (verr) {
            onEvent({
              type: "router",
              phase: "verify_error",
              message: String(verr.message || verr),
            });
          }
        }
        naturalStop = true; // clean tool-free completion — on_stop may veto
        break;
      }

      async function processToolCall(call) {
        if (signal?.aborted) throw new Error("aborted");

        const name = call.function?.name;
        // W2 stage 4a — intake (parse + workingDir pin) is pure (loop-stages.mjs)
        let args = parseToolCallArgs(call, workingDir);

        // Run-scoped allowlist: excluded tools are never advertised, but a
        // hallucinated name must not reach the router either (defense in depth).
        if (toolFilter && !toolFilter.match(name)) {
          const msg = `Tool ${name} is not available in this run (allowTools).`;
          onEvent({ type: "tool", phase: "blocked", name, reason: "allowTools" });
          messages.push(
            makeToolMessage({ tool_call_id: call.id, content: msg, source: "filter" })
          );
          recordTrace(
            finalizeToolTraceEntry(
              beginToolTraceEntry({ name, args, toolCallId: call.id, turn: turns + 1 }),
              {
                resultText: msg,
                blocked: true,
                policy: { phase: "filter", decision: "deny", reason: "allowTools" },
              }
            )
          );
          return;
        }

        // ── Hook: pre_tool_use — matcher-scoped; system hooks may rewrite
        // args, deny outright, or force human approval (decision: "ask").
        let hookForceHuman = false;
        let hookAllow = false;
        {
          const hr = await hooks.executeAll(
            "pre_tool_use",
            { toolName: name, args, turn: turns + 1, sessionKey, workingDir, cfg },
            { mutable: ["args"], matchKey: name }
          );
          if (hr.context.args && hr.context.args !== args) args = hr.context.args;
          if (hr.decision === "deny") {
            const msg = `Tool ${name} blocked by hook${hr.reason ? `: ${hr.reason}` : ""}.`;
            onEvent({ type: "hook", phase: "tool_denied", name, reason: hr.reason || null });
            messages.push(
              makeToolMessage({ tool_call_id: call.id, content: msg, source: "hook" })
            );
            recordTrace(
              finalizeToolTraceEntry(
                beginToolTraceEntry({ name, args, toolCallId: call.id, turn: turns + 1 }),
                {
                  resultText: msg,
                  blocked: true,
                  policy: { phase: "hook", decision: "deny", reason: hr.reason || "hook_deny" },
                }
              )
            );
            return;
          }
          if (hr.decision === "ask") hookForceHuman = true;
          if (hr.decision === "allow") hookAllow = true;
        }

        const verdict = guard.detect(
          name,
          args,
          observedUnknownTools.has(name) ? { unknownToolName: name } : {}
        );
        if (verdict.stuck && verdict.level === "critical") {
          // Progress-based soft-stop: do not throw — keep post-run pipeline (verify, metrics, receipts)
          onEvent({ type: "guard", ...verdict, softStop: true });
          loopGuardStop = true;
          finalText = verdict.message;
          messages.push(
            makeToolMessage({
              tool_call_id: call.id,
              content: verdict.message,
              source: "guard",
            })
          );
          return "stop";
        }
        if (verdict.stuck && verdict.level === "warning") {
          onEvent({ type: "guard", ...verdict });
        }

        // Quota hard-block circuit: refuse further tools after N hard denies.
        try {
          const { guardToolAgainstHardCircuit } = await import("./quota-hard-circuit.mjs");
          const circ = guardToolAgainstHardCircuit(options.job || options.receiptCollector);
          if (circ && circ.ok === false) {
            onEvent({ type: "security", phase: "quota_hard_circuit", reason: circ.reason });
            messages.push(
              makeToolMessage({
                tool_call_id: call.id,
                content: circ.message || "QUOTA_HARD_CIRCUIT",
                source: "quota_circuit",
              })
            );
            return "stop";
          }
        } catch {
          /* circuit optional */
        }

        // Security: allowlist + optional human approval.
        // Bind the plan against this run's workingDir — the shared gate's
        // planRoot is the gateway's process.cwd(), and a plan pinned there
        // fails the spawn-time cwd check in the session workspace.
        const authArgs =
          isExecTool(name) && !args.cwd && !args.workingDir
            ? { ...args, cwd: workingDir }
            : args;
        const auth = await approvalGate.authorize(name, authArgs, {
          job: options.job || options.receiptCollector || null,
          timeoutMs: cfg.security?.approvalTimeoutMs ?? 120_000,
          job: options.job || options.receiptCollector || null,
          // risk scope must resolve against THIS run's workspace (session dir
          // or mission worktree), not the gateway's cwd — without this, file
          // tools' targets scoped against the wrong root (live blind spot)
          riskWorkingDir: workingDir,
          // hook decisions: "ask" escalates to a human even on auto-approve
          // policy. "allow" only pre-answers when a human WOULD have been
          // asked — it never bypasses allowlists or exec pattern checks
          // (hookAllow currently informational; deny>ask>allow already merged).
          // options.forceHuman: session overlay (TUI Shift+Tab "ask") — every
          // tool pends for this run even when the machine is in bypass.
          // options.ignoreBypass: overlay "auto" — drop bypass for this run
          // but keep autoApprove. Overlay can only tighten, never loosen.
          forceHuman: (hookForceHuman && !hookAllow) || Boolean(options.forceHuman),
          ignoreBypass: Boolean(options.ignoreBypass),
          onPending: (info) => {
            onEvent({
              type: "security",
              phase: "approval_required",
              pendingId: info.id,
              name: info.tool,
              args: info.args,
              riskTier: info.risk?.tier || null,
              riskFactors: info.risk?.factors || null,
              riskReasons: info.risk?.reasons || null,
            });
          },
        });
        if (!auth.ok) {
          const isPending =
            auth.reason === "pending" ||
            auth.reason === "timeout" ||
            auth.pending === true ||
            Boolean(auth.pendingId);
          const pendingId = auth.pendingId || auth.id || null;
          if (isPending) {
            lastPendingApproval = {
              id: pendingId,
              tool: name,
              args,
              reason: auth.reason || "pending",
            };
          }
          const msg = isPending
            ? formatBlockedReply({
                tool: name,
                reason: auth.reason || "awaiting approval",
                pendingId,
                argsPreview: JSON.stringify(args || {}).slice(0, 180),
              })
            : auth.message ||
              `Tool ${name} blocked (${auth.reason || "denied"}).`;
          // Prefer a clear user-visible reply when we stop on approval
          if (isPending && !finalText) {
            finalText = msg;
          }
          onEvent({
            type: "security",
            phase: isPending ? "approval_required" : "denied",
            name,
            reason: auth.reason,
            pendingId,
            // authorize already emitted approval_required via onPending when
            // the pending was created; this second emission after a timeout is
            // a STATE UPDATE, not a new ask. `restate` says so on the event
            // itself so a consumer does not have to know this history —
            // telegram and webchat each had to rediscover it and dedupe by
            // hand, months apart. Anything that prompts a human should gate on
            // isNewApprovalAsk().
            restate: true,
            timedOut: auth.reason === "timeout",
            message: msg,
          });
          messages.push(
            makeToolMessage({
              tool_call_id: call.id,
              content: msg,
              source: "security",
            })
          );
          recordTrace(
            finalizeToolTraceEntry(
              beginToolTraceEntry({ name, args, toolCallId: call.id, turn: turns + 1 }),
              {
                resultText: msg,
                blocked: true,
                policy: (lastPolicyDecision = policyDecision({
                  phase: "approval",
                  decision: isPending ? "pending" : "deny",
                  reason: auth.reason || (isPending ? "pending" : "denied"),
                  tool: name,
                  pendingId,
                  message: msg,
                })),
              }
            )
          );
          // Stop the turn on pending approval — don't keep calling tools
          if (isPending) {
            return "stop";
          }
          // Denied calls MUST feed the loop guard: repeated retries of a
          // blocked tool are exactly the stagnation the guard exists to
          // catch (they previously bypassed guard.record entirely).
          guard.record(name, args, `DENIED: ${msg}`);
          return;
        }
        if (auth.mode === "human") {
          onEvent({
            type: "security",
            phase: "approved",
            name,
            mode: auth.mode,
            note: auth.note,
            planFingerprint: auth.planFingerprint || auth.plan?.fingerprint || null,
          });
        }

        // TOCTOU: re-validate frozen systemRunPlan pins after approval, before spawn
        if (
          auth.plan &&
          isExecTool(name) &&
          cfg.security?.bindSystemRunPlan !== false
        ) {
          const rv = revalidatePlan(auth.plan);
          if (!rv.ok) {
            const msg =
              rv.message ||
              `Plan revalidation failed (${rv.reason || "drift"}).`;
            onEvent({
              type: "security",
              phase: "plan_revalidate_failed",
              name,
              reason: rv.reason,
              drift: rv.drift || null,
              planFingerprint: auth.planFingerprint || auth.plan?.fingerprint || null,
              message: msg,
            });
            messages.push(
              makeToolMessage({
                tool_call_id: call.id,
                content: msg,
                source: "security",
              })
            );
            recordTrace(
              finalizeToolTraceEntry(
                beginToolTraceEntry({
                  name,
                  args,
                  toolCallId: call.id,
                  turn: turns + 1,
                }),
                {
                  resultText: msg,
                  blocked: true,
                  policy: (lastPolicyDecision = policyDecision({
                    phase: "plan_revalidate",
                    decision: "deny",
                    reason: rv.reason || "plan_drift",
                    tool: name,
                  })),
                }
              )
            );
            guard.record(name, args, "DENIED: " + (rv.reason || "plan_drift"));
            return;
          }
          onEvent({
            type: "security",
            phase: "plan_revalidated",
            name,
            planFingerprint: auth.planFingerprint || auth.plan?.fingerprint || null,
          });
        }

        // Spawn enforcement: carry frozen plan into computer plane (bash checks at spawn)
        if (auth.plan && isExecTool(name)) {
          args = { ...args, systemRunPlan: auth.plan };
        }

        const sand = guardToolPaths(cfg, workingDir, name, args);
        if (!sand.ok) {
          const msg = sand.error || "sandbox denied";
          onEvent({ type: "security", phase: "sandbox_denied", name, message: msg });
          messages.push(
            makeToolMessage({
              tool_call_id: call.id,
              content: msg,
              source: "sandbox",
            })
          );
          recordTrace(
            finalizeToolTraceEntry(
              beginToolTraceEntry({ name, args, toolCallId: call.id, turn: turns + 1 }),
              {
                resultText: msg,
                blocked: true,
                policy: (lastPolicyDecision = policyDecision({ phase: "sandbox", decision: "deny", reason: msg, tool: name, message: msg })),
              }
            )
          );
          guard.record(name, args, "DENIED: " + msg);
          return;
        }
        args = sand.args || args;

        const eg = guardToolEgress(cfg, name, args);
        if (!eg.ok) {
          const msg = eg.error || "egress denied";
          onEvent({ type: "security", phase: "egress_denied", name, message: msg });
          messages.push(
            makeToolMessage({
              tool_call_id: call.id,
              content: msg,
              source: "egress",
            })
          );
          recordTrace(
            finalizeToolTraceEntry(
              beginToolTraceEntry({ name, args, toolCallId: call.id, turn: turns + 1 }),
              {
                resultText: msg,
                blocked: true,
                policy: (lastPolicyDecision = policyDecision({ phase: "egress", decision: "deny", reason: msg, tool: name, message: msg })),
              }
            )
          );
          guard.record(name, args, "DENIED: " + msg);
          return;
        }

        const riskR = guardHighRiskReceipt(name, options.job || options.jobState || { evidence: options.evidence, receipt: options.receipt, toolTrace }, cfg);
        if (!riskR.ok) {
          const msg = riskR.message || "RECEIPT_REQUIRED";
          onEvent({ type: "security", phase: "receipt_required", name, ...riskR });
          messages.push(makeToolMessage({ tool_call_id: call.id, content: msg, source: "receipt" }));
          recordTrace(finalizeToolTraceEntry(beginToolTraceEntry({ name, args, toolCallId: call.id, turn: turns + 1 }), { resultText: msg, blocked: true, policy: (lastPolicyDecision = policyDecision({ phase: "receipt", decision: "deny", reason: riskR.code || "RECEIPT_REQUIRED", tool: name })) }));
          guard.record(name, args, "DENIED: " + msg);
          return;
        }

        onEvent({ type: "tool", phase: "start", name, args });
        const tracePartial = beginToolTraceEntry({
          name,
          args,
          toolCallId: call.id,
          turn: turns + 1,
        });
        let result;
        let toolThrown = false;
        try {
          if (name === "xclaw_spawn_subagent") {
            const spawnTool = createSpawnTool({
              cfg,
              workingDir,
              signal,
              sessionId,
              onEvent,
            });
            result = await spawnTool.execute(args);
          } else if (name === "xclaw_swarm_run") {
            const swarmTool = createSwarmRunTool({
              cfg,
              workingDir,
              signal,
              sessionId,
              onEvent,
            });
            result = await swarmTool.execute(args);
          } else if (
            name === "xclaw_swarm_merge_approve" ||
            name === "xclaw_swarm_merge_reject" ||
            name === "xclaw_swarm_merge_status"
          ) {
            const mergeTools = createMergeTools({
              cfg,
              workingDir,
              signal,
              sessionId,
              onEvent,
            });
            const mt = mergeTools.find((t) => t.name === name);
            result = await mt.execute(args);
          } else if (name === "xclaw_recall") {
            const recallTool = createRecallTool({ cfg, workingDir });
            result = await recallTool.execute(args);
          } else if (name === "xclaw_forget") {
            const forgetTool = createForgetTool({ cfg, workingDir });
            result = await forgetTool.execute(args);
          } else if (name === "xclaw_repo_intel") {
            const intelTool = createRepoIntelTool({ cfg, workingDir });
            result = await intelTool.execute(args);
          } else if ((options.extraTools || []).some((t) => t.name === name)) {
            const extra = options.extraTools.find((t) => t.name === name);
            result = await extra.execute(args);
          } else {
            // T1: single dispatch path via Tool Router (local | computer | search | mcp)
            let dispatchArgs = args;
            // A3 gateway belt: fabric hooks for browser tab tools before computer plane
            if (name === "xclaw_browser_tab" || name === "browser_tab") {
              try {
                const act = args?.url ? "navigate" : args?.jsCode ? "evaluate" : args?.screenshot ? "observe" : "act";
                const resolvedRole = await resolveRole({
                  sessionId,
                  agentId: sessionId,
                });
                const hr = act === "navigate"
                  ? await beforeNavigate({
                      url: args.url,
                      tabId: args.tabId,
                      agentId: sessionId,
                      sessionId,
                      roleTrusted: resolvedRole.trusted === true,
                      role: resolvedRole.role,
                    })
                  : await beforeInput({
                      tabId: args.tabId,
                      url: args.url,
                      agentId: sessionId,
                      sessionId,
                      roleTrusted: resolvedRole.trusted === true,
                      role: resolvedRole.role,
                      action: act,
                      jsCode: args.jsCode,
                    });
                if (hr && hr.ok === false) {
                  result = {
                    isError: true,
                    content: [{ type: "text", text: `[xclaw-hooks] ${hr.code}: ${hr.reason}` }],
                    metadata: hr,
                  };
                } else {
                  const routed = await toolRouter.dispatch({
                    callId: call.id,
                    name,
                    args: dispatchArgs,
                    plan: args.systemRunPlan || null,
                    signal,
                  });
                  result = routed.result ?? {
                    isError: !routed.ok,
                    content: [{ type: "text", text: routed.error || "tool failed" }],
                  };
                  if (hr?.actionId && result && typeof result === "object") {
                    result.metadata = { ...(result.metadata || {}), actionId: hr.actionId, hook: hr, plane: routed.plane };
                  } else if (result && typeof result === "object") {
                    result.metadata = { ...(result.metadata || {}), plane: routed.plane, durationMs: routed.durationMs };
                  }
                }
              } catch (beltErr) {
                const routed = await toolRouter.dispatch({
                  callId: call.id,
                  name,
                  args: dispatchArgs,
                  plan: args.systemRunPlan || null,
                  signal,
                });
                result = routed.result ?? {
                  isError: !routed.ok,
                  content: [{ type: "text", text: routed.error || "tool failed" }],
                };
              }
            } else {
              const routed = await toolRouter.dispatch({
                callId: call.id,
                name,
                args: dispatchArgs,
                plan: args.systemRunPlan || null,
                signal,
              });
              result = routed.result ?? {
                isError: !routed.ok,
                content: [{ type: "text", text: routed.error || "tool failed" }],
              };
              if (result && typeof result === "object") {
                result.metadata = { ...(result.metadata || {}), plane: routed.plane, durationMs: routed.durationMs };
              }
            }
          }
        } catch (err) {
          toolThrown = true;
          result = {
            isError: true,
            content: [{ type: "text", text: err.message }],
          };
        }
        // Horizon 2: optional truth-channel auto assert after browser_* tools
        try {
          const truth = await afterBrowserToolTruth(name, result);
          if (truth && truth.checked > 0) {
            result = {
              ...result,
              metadata: { ...(result?.metadata || {}), truth },
            };
            if (!truth.ok && result?.content) {
              const note = `\n[truth] FAIL require-rules: ${JSON.stringify(truth.results)}`;
              const texts = result.content.filter((x) => x.type === "text");
              if (texts.length) texts[texts.length - 1].text = String(texts[texts.length - 1].text || "") + note;
              else result.content.push({ type: "text", text: note });
            } else if (truth.ok && result?.content) {
              const note = `\n[truth] OK require-rules checked=${truth.checked}`;
              const texts = result.content.filter((x) => x.type === "text");
              if (texts.length) texts[texts.length - 1].text = String(texts[texts.length - 1].text || "") + note;
            }
          }
        } catch (te) {
          /* truth plane must not break tool path */
        }
        const rawText = formatToolResult(result);
        const truncOpts = truncationOptsFromConfig(cfg, name);
        const trunc = truncOpts.enabled
          ? truncateToolResult(rawText, truncOpts)
          : { text: rawText, truncated: false, originalChars: rawText.length, keptChars: rawText.length };
        let text = trunc.text;
        // ── Hook: post_tool_use — matcher-scoped; system/trusted hooks may
        // replace the result text the model will see (resultText).
        {
          const hr = await hooks.executeAll(
            "post_tool_use",
            {
              toolName: name,
              args,
              resultText: text,
              isError: Boolean(toolThrown || result?.isError),
              turn: turns + 1,
              sessionKey,
              cfg,
            },
            { mutable: ["resultText"], matchKey: name }
          );
          if (typeof hr.context.resultText === "string" && hr.context.resultText !== text) {
            text = hr.context.resultText;
            onEvent({ type: "hook", phase: "mutated", category: "post_tool_use", name });
          }
        }
        const unknownToolOutcome =
          (toolThrown || result?.isError === true) &&
          UNROUTABLE_TOOL_RE.test(rawText);
        if (unknownToolOutcome) observedUnknownTools.add(name);
        guard.record(
          name,
          args,
          text,
          unknownToolOutcome ? { unknownToolName: name } : {}
        );
        const traceEntry = finalizeToolTraceEntry(tracePartial, {
          resultText: text,
          originalChars: trunc.originalChars,
          keptChars: trunc.keptChars,
          truncated: trunc.truncated,
          result,
          thrown: toolThrown || Boolean(result?.isError),
        });
        recordTrace(traceEntry);
        try {
          const u = result?.usage || result?.tokenUsage || {};
          recordToolTokens(name, {
            prompt: Number(u.prompt_tokens || u.prompt || 0),
            completion: Number(u.completion_tokens || u.completion || 0),
            cached: Number(u.cached_tokens || u.cached || 0),
          });
        } catch { /* */ }
        onEvent({
          type: "tool",
          phase: "end",
          name,
          preview: text.slice(0, 200),
          truncated: trunc.truncated,
          originalChars: trunc.originalChars,
          keptChars: trunc.keptChars,
          status: traceEntry.status,
          outcome: traceEntry.outcome,
          artifacts: traceEntry.artifacts,
        });

        // Freeze rank size at insert (pre-stub). Use originalChars so
        // later head/tail eviction does not change size-weighted order.
        messages.push(
          makeToolMessage({
            tool_call_id: call.id,
            content: text,
            rankSize: trunc.originalChars ?? text.length,
            source: "insert",
          })
        );

        if (verdict.stuck && verdict.level === "warning") {
          // User-role notice: avoids mutating/extending system prefix (cache-safe)
          messages.push(
            makeEphemeralNotice(
              verdict.message +
                " Do not repeat the same tool call. Finish or change approach."
            )
          );
          if (escalateTurnsLeft === 0 && cfg.agent?.escalateOnStuck !== false) {
            escalateTurnsLeft = Number(cfg.agent?.escalateTurns ?? 3);
            onEvent({ type: "router", phase: "escalate", reason: verdict.detector || "stagnation", turns: escalateTurnsLeft });
          }
        }
      } // end processToolCall

      // T2: plane-aligned partition + maxParallel chunks + abort between chunks
      const { stop: stopTools } = await runToolBatches(calls, {
        processFn: processToolCall,
        signal,
        cfg,
        onEvent,
      });
      // W2 stage 2a — pairing invariant (see loop-stages.mjs): every tool_call
      // id gets a tool message even when a mid-batch stop skipped it; an
      // orphaned tool_use 400s the next Anthropic request.
      for (const skip of planPairingBackfill(calls, messages)) {
        onEvent(skip.event);
        messages.push(
          makeToolMessage({
            tool_call_id: skip.callId,
            content: skip.content,
            source: "skipped",
          })
        );
      }

      // Honor the batch stop: a "stop" from processToolCall (guard critical,
      // pending approval, quota hard circuit) means the run cannot productively
      // continue — issuing another model turn just retries the blocked action
      // (the approval-storm mechanism). The pairing backfill above keeps the
      // transcript valid; the post-run pipeline (verify, metrics, receipts)
      // still runs after the loop.
      if (stopTools) {
        toolHaltStop = true;
        if (!finalText) {
          finalText =
            "Stopped: tool execution halted by policy (guard, approval, or quota).";
        }
        break;
      }
    }

    // ── Hook: on_stop — only on clean tool-free completions (never on
    // guard stops, pending approvals, budget stops, or aborts).
    if (
      naturalStop &&
      finalText &&
      !loopGuardStop &&
      !lastPendingApproval &&
      !signal?.aborted
    ) {
      const sr = await hooks.executeAll("on_stop", {
        text: finalText,
        turns,
        stopBlocks,
        stopHookActive: stopBlocks > 0,
        sessionKey,
        cfg,
      });
      if (sr.abort && stopBlocks < stopBlockCap) {
        stopBlocks += 1;
        onEvent({
          type: "hook",
          phase: "stop_blocked",
          reason: sr.abort,
          stopBlocks,
          cap: stopBlockCap,
        });
        messages.push({
          role: "user",
          content: `[stop-hook] Not finished: ${sr.abort}. Address this, then finish.`,
        });
        finalText = "";
        continue stopCycle;
      }
      if (sr.abort) {
        onEvent({ type: "hook", phase: "stop_block_cap", cap: stopBlockCap });
      }
    }
    break stopCycle;
    } // end stopCycle

    if (turns >= totalTurnCap && !finalText) {
      maxTurnsStop = true;
      // Final-answer rescue: hitting the turn budget mid-work used to discard
      // EVERYTHING (live: a 5-node research swarm returned 0/5 ballots — every
      // node stopped at maxTurns with only the stub text below, and the run
      // still claimed success). One more model call with NO tools asks for the
      // best answer from work done so far. Off via agent.finalAnswerRescue:false.
      // W2 stage 3 — the rescue plan (message, stamp, stub) is pure
      // (loop-stages.mjs); the provider call stays here.
      const rescuePlan = planFinalAnswerRescue({ cfg, rescuePrompt, totalTurnCap });
      if (rescuePlan.enabled) {
        try {
          const rescue = await provider.chat({
            messages: [...messages, rescuePlan.userMessage],
          });
          const text =
            typeof rescue?.message?.content === "string"
              ? rescue.message.content.trim()
              : "";
          if (text) {
            finalText = rescuePlan.formatRescuedText(text);
            onEvent({ type: "lifecycle", phase: "final_answer_rescue", turns });
          }
        } catch {
          /* rescue is best-effort — fall through to the stub */
        }
      }
      if (!finalText) finalText = rescuePlan.stubText;
    }

    // ── Hook: post_process — system/trusted hooks may transform the final
    // text; runs before the transcript save (finally) so redactions persist.
    if (finalText) {
      const hr = await hooks.executeAll(
        "post_process",
        { text: finalText, turns, sessionKey, cfg },
        { mutable: ["text"] }
      );
      if (typeof hr.context.text === "string" && hr.context.text !== finalText) {
        finalText = hr.context.text;
        onEvent({ type: "hook", phase: "mutated", category: "post_process" });
      }
    }
  } catch (err) {
    // ── Hook: on_error — observe loop failures; the error still propagates.
    await hooks.executeAll("on_error", {
      error: String(err?.message || err),
      turn: turns,
      sessionKey,
      cfg,
    });
    throw err;
  } finally {
    try {
      unregisterSession(sessionKey);
    } catch {
      /* ignore */
    }
    try {
      mcpTools?.close?.();
    } catch {
      /* ignore */
    }
    await computer.destroySession(sessionId).catch(() => {});

    // Durable transcript (local-only)
    if (transcriptId && cfg.agent?.persistTranscript !== false) {
      try {
        appendTranscript(cfg, transcriptId, {
          role: "user",
          content: String(userMessage || "").slice(0, 100_000),
        });
        if (finalText) {
          appendTranscript(cfg, transcriptId, {
            role: "assistant",
            content: String(finalText).slice(0, 100_000),
            turns,
          });
        }
        onEvent({
          type: "context",
          phase: "transcript_save",
          sessionId: transcriptId,
        });
      } catch (err) {
        onEvent({
          type: "context",
          phase: "transcript_save_error",
          message: String(err.message || err),
        });
      }
    }

    onEvent({ type: "lifecycle", phase: "end", turns, sessionId });
  }

  const usageSnap = usageTracker.snapshot();
  if (usageSnap) {
    const cache = aggregateCacheStats(usageSnap.turns || []);
    usageSnap.cache = cache;
    usageSnap.cacheTips = cachingRecommendations({
      provider: cfg.agent?.provider,
      model: provider.model,
      cache,
    });
    try {
      usageSnap.cacheByTool = analyzeCacheByTool({
        usageTurns: usageSnap.turns || [],
        toolTrace,
        events: eventLog,
      });
    } catch (err) {
      usageSnap.cacheByTool = { error: String(err?.message || err) };
    }
  }
  if (tokensEnabled && usageSnap && (usageSnap.hasCost || usageSnap.hasRealUsage)) {
    // Providers that return no cost (anthropic OAuth) used to land $null
    // rows — the governor and economy band saw $0 for the dominant traffic.
    // Estimate from getModelMeta list rates and mark the row estimated.
    let runCostUsd = usageSnap.hasCost ? usageSnap.costUsd : null;
    let costEstimated = false;
    if (runCostUsd == null) {
      try {
        const { estimateUsdFromUsage } = await import("../tokens/cost-governor.mjs");
        const est = estimateUsdFromUsage(
          { prompt_tokens: usageSnap.promptTokens, completion_tokens: usageSnap.completionTokens },
          cfg,
          { modelRef: provider?.modelRef || provider?.model || cfg.agent?.model }
        );
        if (est > 0) {
          runCostUsd = est;
          costEstimated = true;
        }
      } catch {
        /* estimation optional */
      }
    }
    // Feed the DAILY governor — before this, only /job mode recorded spend,
    // so normal channel/mission traffic never moved the soft/hard caps or
    // the economy band.
    if (runCostUsd > 0) {
      try {
        const { recordJobCost } = await import("../tokens/cost-governor.mjs");
        await recordJobCost(cfg, { usd: runCostUsd, jobId: sessionId, estimated: costEstimated });
      } catch {
        /* governor best-effort */
      }
    }
    await usageTracker.persistLedger({
      // runId + provider power the per-provider Usage & Logs views — every
      // ledger entry must say which provider actually served it (model name
      // alone is ambiguous across gateways/routers).
      runId: (await import("node:crypto")).randomUUID(),
      provider: provider?.providerName || route?.provider || cfg.agent?.provider || null,
      sessionId,
      userMessagePreview: String(userMessage || "").slice(0, 120),
      ...(costEstimated ? { costUsd: runCostUsd, costEstimated: true } : {}),
      cache: usageSnap.cache,
    });
  }

  let recentPrompts = [];
  let biasMap = null;
  try {
    const { recentTappedPrompts } = await import("./suggestions.mjs");
    recentPrompts = recentTappedPrompts(30);
  } catch {
    /* */
  }
  try {
    const fb = await import("./suggestion-feedback.mjs");
    const store = await fb.loadSuggestionFeedback(cfg);
    recentPrompts = [
      ...fb.recentPromptsFromStore(store, 30),
      ...recentPrompts,
    ];
    biasMap = fb.buildScoreBiasMap(store, userId, {
      priorCtr: cfg.suggestions?.priorCtr,
      priorStrength: cfg.suggestions?.priorStrength,
      userMinShown: cfg.suggestions?.userMinShown,
    });
    // Record "shown" will be done by channel; mark planned sources here optional
  } catch {
    /* feedback optional */
  }
  let closure = null;
  try {
    const { detectTurnClosure } = await import("./suggestions.mjs");
    closure = detectTurnClosure({
      userMessage,
      replyText: finalText,
      toolTrace,
      cfg,
    });
  } catch {
    closure = null;
  }

  const turnState = buildTurnState({
    userMessage,
    goal,
    toolTrace,
    turns,
    maxTurns,
    finalText,
    pendingApproval: lastPendingApproval,
    loopGuardStop,
    aborted: Boolean(signal?.aborted) || aborted,
    closure,
  });
  onEvent({
    type: "turn_state",
    phase: turnState.phase,
    summary: turnState.summary,
    goal: turnState.goal,
    progress: {
      phase: turnState.progress.phase,
      toolsRun: turnState.progress.toolsRun,
      counts: turnState.progress.counts,
      blockers: turnState.progress.blockers,
      pendingApproval: turnState.progress.pendingApproval,
    },
  });

  const suggestions = buildTurnSuggestions({
    userMessage,
    replyText: finalText,
    toolTrace,
    cfg,
    recentPrompts,
    biasMap,
    userId,
    workingDir,
    pendingApproval: lastPendingApproval,
    turnState,
  });
  if (suggestions.length) {
    onEvent({
      type: "suggestions",
      phase: "ready",
      items: suggestions,
    });
  }
  try {
    const { recordAgentTurnMetrics } = await import("./agent-metrics.mjs");
    const { shouldSuppressSuggestions } = await import("./suggestions.mjs");
    const gate = shouldSuppressSuggestions({
      userMessage,
      replyText: finalText,
      toolTrace,
      cfg,
      pendingApproval: lastPendingApproval,
    });
    recordAgentTurnMetrics({
      toolTrace,
      suggestions,
      closure,
      suppressed: gate.suppress === true,
      turnPhase: turnState.phase,
    });
  } catch {
    /* metrics optional */
  }

  // Why the run ended — computed once, used by the durable snapshot AND the
  // return value. Orchestrators must distinguish "the model finished" from
  // "the runtime cut it off" (a turn cap is an execution constraint, never
  // evidence the user's objective is complete).
  // (W2 stage 2b — priority chain lives in loop-stages.mjs computeStopReason.)
  const stopReason = computeStopReason({
    signalAborted: signal?.aborted,
    aborted,
    hookAbort,
    loopGuardStop,
    lastPendingApproval,
    toolHaltStop,
    budgetStop,
    maxTurnsStop,
  });

  // Feature 2 — durable snapshot for resume
  try {
    if (options.sessionId || options.persistRun) {
      await saveAgentRun(cfg, {
        sessionId: options.sessionId || options.runId || `run_${Date.now().toString(36)}`,
        workingDir: options.workingDir || process.cwd(),
        model: provider?.model || cfg.agent?.model,
        streamId: options.streamId || null,
        messages,
        toolTrace,
        turns,
        // Honest terminal state: "completed" is reserved for runs the model
        // actually finished — a cutoff persists AS its stopReason so restart
        // recovery can tell resumable work from done work (loop-stages.mjs).
        status: terminalStatus(stopReason),
        stopReason,
        meta: { goal: typeof userMessage === "string" ? userMessage.slice(0, 200) : null },
      });
    }
  } catch (e) {
    onEvent({ type: "session", phase: "persist_fail", error: e?.message || String(e) });
  }

  let hallucinationCanary = null;
  try {
    const softOnce = options._canarySoftUsed !== true;
    if (softOnce) {
      const soft = softCanaryRecover({ text: finalText, toolTrace, messages });
      hallucinationCanary = soft.canary;
      if (soft.recovered) {
        options._canarySoftUsed = true;
        onEvent({ type: "canary", phase: "soft_recover", ...soft.canary });
      }
    } else {
      hallucinationCanary = runHallucinationCanary({ text: finalText, toolTrace });
      if (hallucinationCanary && !hallucinationCanary.ok) {
        incCanaryUngrounded(1);
        onEvent({ type: "canary", phase: "ungrounded", ...hallucinationCanary });
      }
    }
  } catch { /* */ }

  return {
    text: stripClaimsBlock(finalText) || "(no response)",
    // Raw final text WITH the claims scaffold — the claims gate must score
    // this, not the stripped presentation text above: stripping the block and
    // then failing the job for "missing structured claims JSON block" punished
    // the model for the runtime's own strip (2026-08-23 soak nights 1–2).
    finalText,
    canary: hallucinationCanary,
    turns,
    toolTrace,
    model: provider?.model,
    sessionId,
    suggestions,
    turnState,
    // Surfaced so orchestrators can resume the blocked action after a human
    // decision without digging into turnState internals.
    pendingApproval: lastPendingApproval,
    // S6b: the typed ruling from the last blocking gate (null when nothing
    // blocked) — one shape across approval/sandbox/egress/plan/receipt.
    policyDecision: lastPolicyDecision,
    stopReason,
    context: {
      skills: (skills || []).map((s) => s.name),
      memory: (memoryFiles || []).map((m) => m.path),
    },
    usage: usageSnap,
  };
  } finally {
    try {
      unregisterSession(sessionKey);
    } catch {
      /* ignore */
    }
  }
}
