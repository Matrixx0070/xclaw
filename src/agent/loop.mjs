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
import { createProvider } from "./provider.mjs";
import { createFailoverProvider } from "../providers/failover-router.mjs";
import { createRoleRouter, selectRole } from "../providers/role-router.mjs";
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
import { getSharedApprovalGate } from "../security/approvals.mjs";
import { partitionToolCalls, runToolBatches, resolveMaxParallel } from "./tool-concurrency.mjs";
import {
  appendTranscript,
  loadTranscriptHistory,
} from "../sessions/transcript.mjs";
import { revalidatePlan, isExecTool } from "../security/system-run-plan.mjs";
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
import { createRecallTool } from "../memory/recall.mjs";
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
  makeEphemeralNotice,
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
import { guardToolEgress } from "../security/egress.mjs";
import { registerSession, unregisterSession } from "./session-control.mjs";
import { makeToolMessage, freezeRankSize } from "../tokens/rank-size.mjs";
import { createAllLocalTools, localToolsAsOpenAI, executeLocalTool, localToolNames } from "../tools/registry.mjs";
import { createToolRouter } from "../tools/router.mjs";
import { searchPlaneToolsAsOpenAI } from "../planes/search.mjs";
import { afterBrowserToolTruth } from "../browser/truth.mjs";
import { beforeNavigate, beforeInput } from "../browser/hooks.mjs";
import { resolveRole } from "../browser/role-binding.mjs";

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

  const maxTurns = cfg.agent?.maxTurns ?? 15;
  const skillsEnabled = cfg.skills?.enabled !== false;
  const memoryEnabled = cfg.memory?.enabled !== false;

  // Outer try ensures kill-switch unregister even if setup throws
  try {
  const computer = createComputerClient(cfg);
  const useFailover = cfg.router?.enabled !== false;
  let provider;
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
  try {
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
        model: cfg.agent?.model || process.env.XCLAW_MODEL,
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
        model: cfg.agent?.model || process.env.XCLAW_MODEL,
        provider: cfg.agent?.provider || process.env.XCLAW_PROVIDER,
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
        model: route.model || cfg.agent?.model || process.env.XCLAW_MODEL || "gpt-4o-mini",
        provider: route.provider,
        api: route.api,
        cfg,
        onRetry: onRetryProvider,
      });
      provider.providerName = route.provider;
    }
  }

  if (!provider) {
    route = await resolveProviderRouteAsync(cfg, {
      model: cfg.agent?.model || process.env.XCLAW_MODEL,
      provider: cfg.agent?.provider || process.env.XCLAW_PROVIDER,
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
      model: route.model || cfg.agent?.model || process.env.XCLAW_MODEL || "gpt-4o-mini",
      provider: route.provider,
      api: route.api,
      cfg,
      onRetry: onRetryProvider,
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
  });
  // Stable prefix for provider prompt caching (xAI cached_tokens, etc.)
  const systemContent = buildCacheableSystemPrompt({
    basePrompt: BASE_SYSTEM_PROMPT,
    contextSections,
  });

  // Computer session
  const ready = await ensureComputer(cfg, { log: cfg.computer?.logEnsure !== false });
  if (!ready.ok) {
    throw new Error(ready.error || "Computer server is not available");
  }
  const sessionId = await computer.createSession(workingDir);
  onEvent({ type: "computer", phase: "session", sessionId });

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
    tools.push(...searchPlaneToolsAsOpenAI());
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
    onEvent({
      type: "tools",
      count: tools.length,
      names: tools.map((t) => t.function.name),
    });
  } catch (err) {
    await computer.destroySession(sessionId).catch(() => {});
    throw new Error(`Failed to list computer tools: ${err.message}`);
  }
  if (typeof localTools === "undefined") localTools = createAllLocalTools({ workingDir, cfg, computer, sessionId });
  const toolRouter = createToolRouter({
    computer,
    sessionId,
    localTools,
    cfg,
    workingDir,
  });


  const sysBuilt = buildSystemMessageWithBreakpoints({
    basePrompt: BASE_SYSTEM_PROMPT,
    contextSections,
    cfg,
    model: provider.model,
    baseUrl: provider.baseUrl,
    provider: cfg.agent?.provider,
  });
  const optimized = optimizePrefix({
    systemMessage: sysBuilt.message,
    tools,
  });
  tools = optimized.tools;
  const prefixHash = optimized.fingerprint.hash;
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
  // Durable transcript load when caller did not pass history
  if (!prior.length && transcriptId && cfg.agent?.persistTranscript !== false) {
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
  let messages = [
    optimized.systemMessage,
    ...priorCapped,
    { role: "user", content: userMessage },
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
  const approvalGate = options.approvalGate || getSharedApprovalGate(cfg);
  const toolTrace = [];
  resetToolTraceSeq();
  const goal = inferGoal(userMessage);
  let lastPendingApproval = null;
  let loopGuardStop = false;
  let aborted = false;
  let finalText = "";
  let turns = 0;
  let dualState = null;
  let lastEvictReport = null;
  let prevWeights = null;

  try {
    for (turns = 0; turns < maxTurns; turns++) {
      if (signal?.aborted) throw new Error("aborted");

      onEvent({ type: "model", phase: "request", turn: turns + 1 });
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
      {
        const cOpts = compactionOptsFromConfig(cfg);
        if (cOpts.enabled) {
          const { messages: compacted, report: cReport } = await compactMessages(
            messages,
            { ...cOpts, pressure }
          );
          if (!cReport.skipped) {
            messages = compacted;
            onEvent({ type: "cache", phase: "compaction", ...cReport });
          }
        }
      }
      const turnRole =
        typeof provider.selectRoleForTurn === "function"
          ? provider.selectRoleForTurn({
              turn: turns,
              forceAct: turns > 0,
            })
          : null;
      const chatArgs = {
        messages,
        tools,
        ...(turnRole ? { role: turnRole } : {}),
      };
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
        });
        if (entry) {
          onEvent({
            type: "tokens",
            phase: entry.estimated ? "estimate" : "usage",
            ...entry,
          });
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
            if (!v.skipped && v.replaced && v.finalText) {
              finalText = v.finalText;
              messages.push({
                role: "assistant",
                content: finalText,
                _xclawVerify: true,
              });
            } else if (!v.skipped && v.revise && v.revisedText && !v.replaced) {
              // Soft mode: keep act answer, attach critique in event only
              onEvent({
                type: "router",
                phase: "verify_suggest",
                suggestion: v.revisedText.slice(0, 2000),
              });
            }
          } catch (verr) {
            onEvent({
              type: "router",
              phase: "verify_error",
              message: String(verr.message || verr),
            });
          }
        }
        break;
      }

      async function processToolCall(call) {
        if (signal?.aborted) throw new Error("aborted");

        const name = call.function?.name;
        let args = {};
        try {
          args = JSON.parse(call.function?.arguments || "{}");
        } catch {
          args = {};
        }

        const verdict = guard.detect(name, args);
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

        // Security: allowlist + optional human approval
        const auth = await approvalGate.authorize(name, args, {
          timeoutMs: cfg.security?.approvalTimeoutMs ?? 120_000,
          onPending: (info) => {
            onEvent({
              type: "security",
              phase: "approval_required",
              pendingId: info.id,
              name: info.tool,
              args: info.args,
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
            message: msg,
          });
          messages.push(
            makeToolMessage({
              tool_call_id: call.id,
              content: msg,
              source: "security",
            })
          );
          toolTrace.push(
            finalizeToolTraceEntry(
              beginToolTraceEntry({ name, args, toolCallId: call.id, turn: turns + 1 }),
              {
                resultText: msg,
                blocked: true,
                policy: {
                  phase: "approval",
                  decision: isPending ? "pending" : "deny",
                  reason: auth.reason || (isPending ? "pending" : "denied"),
                  pendingId,
                },
              }
            )
          );
          // Stop the turn on pending approval — don't keep calling tools
          if (isPending) {
            return "stop";
          }
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
            toolTrace.push(
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
                  policy: {
                    phase: "plan_revalidate",
                    decision: "deny",
                    reason: rv.reason || "plan_drift",
                  },
                }
              )
            );
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
          toolTrace.push(
            finalizeToolTraceEntry(
              beginToolTraceEntry({ name, args, toolCallId: call.id, turn: turns + 1 }),
              {
                resultText: msg,
                blocked: true,
                policy: { phase: "sandbox", decision: "deny", reason: msg },
              }
            )
          );
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
          toolTrace.push(
            finalizeToolTraceEntry(
              beginToolTraceEntry({ name, args, toolCallId: call.id, turn: turns + 1 }),
              {
                resultText: msg,
                blocked: true,
                policy: { phase: "egress", decision: "deny", reason: msg },
              }
            )
          );
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
        const text = trunc.text;
        guard.record(name, args, text);
        const traceEntry = finalizeToolTraceEntry(tracePartial, {
          resultText: text,
          originalChars: trunc.originalChars,
          keptChars: trunc.keptChars,
          truncated: trunc.truncated,
          result,
          thrown: toolThrown || Boolean(result?.isError),
        });
        toolTrace.push(traceEntry);
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
        }
      } // end processToolCall

      // T2: plane-aligned partition + maxParallel chunks + abort between chunks
      const { stop: stopTools } = await runToolBatches(calls, {
        processFn: processToolCall,
        signal,
        cfg,
        onEvent,
      });
      void stopTools;
    }

    if (turns >= maxTurns && !finalText) {
      finalText = `Stopped after ${maxTurns} turns (maxTurns).`;
    }
  } finally {
    try {
      unregisterSession(sessionKey);
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
    await usageTracker.persistLedger({
      sessionId,
      userMessagePreview: String(userMessage || "").slice(0, 120),
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

  return {
    text: finalText || "(no response)",
    turns,
    toolTrace,
    model: provider?.model,
    sessionId,
    suggestions,
    turnState,
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
