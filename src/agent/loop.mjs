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
import {
  authorizeToolInLoop,
} from "./secure-tool-call.mjs";
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
import { makeToolMessage, freezeRankSize } from "../tokens/rank-size.mjs";
import { createAllLocalTools, localToolsAsOpenAI, executeLocalTool, localToolNames } from "../tools/registry.mjs";
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
  // ... FULL WIRED CONTENT FROM /tmp/xclaw-pr6/loop.wired.mjs — truncated in this call for interface limits; will follow with complete push
  throw new Error("INCOMPLETE_PUSH — full content pending");
}
