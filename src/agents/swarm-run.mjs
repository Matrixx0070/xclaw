/**
 * S1 fan-out + S2 task-graph swarm runner.
 *
 * S1: flat parallel tasks → join summary
 * S2: id + dependsOn DAG → topological waves → upstream handoff → skip-downstream
 */
import { spawnSubagent } from "./spawn.mjs";
import {
  attachNodeReceipt,
  buildRunReceiptSummary,
  evaluateReceiptPolicy,
  receiptsRequired,
} from "./swarm-receipt.mjs";
import {
  createSwarmRun,
  updateSwarmRun,
  getSwarmRun,
} from "./swarm-store.mjs";
import {
  createRunJournal,
  readJournal,
  computeGraphHash,
  slimResultForJournal,
} from "./swarm-journal.mjs";
import {
  topologicalWaves,
  toAsciiWaves,
  toMermaid,
  toDot,
} from "./graph-viz.mjs";
import { planAndMaybeMerge, resolveMergePolicy } from "./swarm-merge.mjs";
import { applyWorktreeMerge, removeWorktree } from "./worktree.mjs";
import path from "node:path";
import {
  structuredMajorityVote,
  formatVoteReport,
  STRUCTURED_BALLOT_PROMPT,
} from "./swarm-vote.mjs";

const ROLES = {
  research: {
    maxTurns: 6,
    worktree: false,
    isolateWorkspace: true,
    promptPrefix:
      "Role: research. Read and search only when needed. Return concise findings with sources/paths. Do not modify the repo.\n\n" +
      STRUCTURED_BALLOT_PROMPT +
      "\n\n",
  },
  implement: {
    maxTurns: 8,
    worktree: true,
    isolateWorkspace: false,
    promptPrefix:
      "Role: implement. Make the requested changes. Prefer small diffs. Summarize files touched.\n\n",
  },
  verify: {
    maxTurns: 5,
    worktree: false,
    isolateWorkspace: false,
    promptPrefix:
      "Role: verify. Check whether the goal was met using tools. Report pass/fail and evidence.\n\n",
  },
  critic: {
    maxTurns: 4,
    worktree: false,
    isolateWorkspace: false,
    promptPrefix:
      "Role: critic. Review the plan/results for risks and gaps. Do not implement. " +
      "Session physics: no motor (click/type). You may approve/reject commit_gate. Do not acquire actor tab leases. " +
      'End your final message with one JSON line: {"verdict":"approve"|"block","confidence":0..1,"reasons":["..."]} — ' +
      'use "block" only if the work must NOT merge as-is. This verdict line is authoritative; prose does not gate the merge.\n\n',
  },
  actor: {
    maxTurns: 8,
    worktree: false,
    isolateWorkspace: false,
    promptPrefix:
      "Role: actor. You may use browser motor tools. Acquire tab_lease before interacting. " +
      "For irreversible URLs (pay/checkout/delete/send), open commit_gate and wait for critic approval.\n\n",
  },
  observer: {
    maxTurns: 5,
    worktree: false,
    isolateWorkspace: false,
    promptPrefix:
      "Role: observer. Read-only browser sense (browser_observe/snapshot). No click/type/navigate.\n\n",
  },
};

// Handoff size defaults — config-overridable (swarm.upstreamMaxChars /
// swarm.resultMaxChars). Raised from the original 1800/1500: modern context
// windows make aggressive cuts needlessly lossy, and truncation is now MARKED
// instead of silent.
const DEFAULT_UPSTREAM_MAX_CHARS = 6000;
const DEFAULT_RESULT_MAX_CHARS = 4000;
const MIN_HANDOFF_CHARS = 200;

/** Resolve handoff char limits from config (floored at MIN_HANDOFF_CHARS). */
export function handoffLimits(swarmCfg = {}) {
  const num = (v, dflt) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : dflt;
  };
  return {
    upstream: Math.max(
      MIN_HANDOFF_CHARS,
      num(swarmCfg.upstreamMaxChars, DEFAULT_UPSTREAM_MAX_CHARS)
    ),
    result: Math.max(
      MIN_HANDOFF_CHARS,
      num(swarmCfg.resultMaxChars, DEFAULT_RESULT_MAX_CHARS)
    ),
  };
}

/**
 * Config-driven swarm caps (swarm.maxParallel / swarm.maxNodes, legacy alias
 * swarm.maxChildrenPerRun) with absolute ceilings against runaway configs.
 */
export function resolveSwarmCaps(swarmCfg = {}) {
  return {
    maxParallel: Math.max(1, Math.min(16, Number(swarmCfg.maxParallel ?? 3) || 3)),
    maxChildren: Math.max(
      1,
      Math.min(50, Number(swarmCfg.maxNodes ?? swarmCfg.maxChildrenPerRun ?? 8) || 8)
    ),
  };
}

/** Truncate with a VISIBLE marker so downstream agents/operators see the loss. */
export function truncateWithMarker(text, max, cfgKey) {
  const s = String(text || "");
  if (s.length <= max) return s;
  const cut = s.length - max;
  return (
    s.slice(0, max).trimEnd() +
    `\n…[truncated ${cut} chars — raise swarm.${cfgKey}]`
  );
}

/**
 * Structured swarm error codes (pre-flight and runtime).
 * @typedef {'SWARM_DISABLED'|'TASKS_REQUIRED'|'MISSING_ID'|'MISSING_TASK'|'DUPLICATE_ID'|'UNKNOWN_DEP'|'SELF_DEP'|'CYCLE'|'TOO_MANY_TASKS'|'INVALID_POLICY'|'PERSIST_FAILED'|'SPAWN_FAILED'|'ABORTED'|'SPAWN_DEPTH_EXCEEDED'} SwarmErrorCode
 */

/**
 * @param {SwarmErrorCode} code
 * @param {string} message
 * @param {object} [details]
 * @returns {{ ok: false, error: string, code: string, retryable: boolean, details: object }}
 */
export function swarmError(code, message, details = {}) {
  const retryable = [
    "PERSIST_FAILED",
    "SPAWN_FAILED",
  ].includes(code);
  return {
    ok: false,
    error: message,
    code,
    retryable,
    details: { ...details },
  };
}

/** Human-readable hints for common codes */
export const SWARM_ERROR_HINTS = {
  SWARM_DISABLED: "Set swarm.enabled: true in config (or omit the flag).",
  TASKS_REQUIRED: "Pass a non-empty tasks array or newline-separated string.",
  MISSING_ID: "Each object task needs a non-empty id (or rely on auto t0..tn).",
  MISSING_TASK: "Each node needs a non-empty task string.",
  DUPLICATE_ID: "Node ids must be unique within the swarm run.",
  UNKNOWN_DEP: "dependsOn must reference ids that exist in the same tasks list.",
  SELF_DEP: "A node cannot depend on itself.",
  CYCLE: "Task graph must be a DAG — remove cyclic dependsOn edges.",
  TOO_MANY_TASKS: "Reduce tasks or raise swarm.maxNodes (absolute ceiling 50).",
  SPAWN_DEPTH_EXCEEDED:
    "Nested agents may not fan out past swarm.maxSpawnDepth (default 2) — flatten the task graph or raise the limit.",
  INVALID_POLICY: "onDepFail must be skip-downstream | fail-fast | best-effort.",
  PERSIST_FAILED: "Disk write under ~/.xclaw/swarms failed — check permissions.",
  SPAWN_FAILED: "Child agent failed to start or crashed — see node error.",
  ABORTED: "Parent AbortSignal fired — swarm stopped early.",
};

/**
 * Normalize tasks into graph nodes with stable ids.
 * Flat S1 tasks (no dependsOn) get auto ids t0..tn.
 * @param {Array|string} tasks
 * @returns {{ nodes: object[], error?: string, code?: string, details?: object }}
 */
export function normalizeTaskGraph(tasks) {
  let list = tasks || [];
  if (typeof list === "string") {
    list = list
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(list) || !list.length) {
    return {
      nodes: [],
      error: "tasks required",
      code: "TASKS_REQUIRED",
      details: { hint: SWARM_ERROR_HINTS.TASKS_REQUIRED },
    };
  }

  const nodes = list.map((t, i) => {
    if (typeof t === "string") {
      return {
        id: `t${i}`,
        task: t,
        role: "research",
        dependsOn: [],
        status: "pending",
      };
    }
    const id = String(t.id || `t${i}`).trim();
    const deps = Array.isArray(t.dependsOn)
      ? t.dependsOn.map(String)
      : t.dependsOn
        ? [String(t.dependsOn)]
        : [];
    return {
      id,
      task: String(t.task || t.prompt || "").trim(),
      role: String(t.role || "research").toLowerCase(),
      dependsOn: [...new Set(deps)],
      status: "pending",
      maxTurns: t.maxTurns,
      worktree: t.worktree,
      isolateWorkspace: t.isolateWorkspace,
    };
  });

  for (const n of nodes) {
    if (!n.id) {
      return {
        nodes: [],
        error: "graph node missing id",
        code: "MISSING_ID",
        details: { hint: SWARM_ERROR_HINTS.MISSING_ID },
      };
    }
    if (!n.task) {
      return {
        nodes: [],
        error: `node ${n.id} missing task`,
        code: "MISSING_TASK",
        details: { nodeId: n.id, hint: SWARM_ERROR_HINTS.MISSING_TASK },
      };
    }
  }

  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) {
    const seen = new Set();
    const dups = [];
    for (const n of nodes) {
      if (seen.has(n.id)) dups.push(n.id);
      seen.add(n.id);
    }
    return {
      nodes: [],
      error: "duplicate node id in task graph",
      code: "DUPLICATE_ID",
      details: { duplicates: dups, hint: SWARM_ERROR_HINTS.DUPLICATE_ID },
    };
  }
  for (const n of nodes) {
    for (const d of n.dependsOn) {
      if (!ids.has(d)) {
        return {
          nodes: [],
          error: `unknown dependsOn: ${d} (from ${n.id})`,
          code: "UNKNOWN_DEP",
          details: {
            nodeId: n.id,
            dependsOn: d,
            hint: SWARM_ERROR_HINTS.UNKNOWN_DEP,
          },
        };
      }
      if (d === n.id) {
        return {
          nodes: [],
          error: `self-dependency: ${n.id}`,
          code: "SELF_DEP",
          details: { nodeId: n.id, hint: SWARM_ERROR_HINTS.SELF_DEP },
        };
      }
    }
  }

  try {
    topologicalWaves(nodes);
  } catch (e) {
    const msg = e.message || String(e);
    const code = /cycle/i.test(msg) ? "CYCLE" : "UNKNOWN_DEP";
    return {
      nodes: [],
      error: msg,
      code,
      details: { hint: SWARM_ERROR_HINTS[code] || msg },
    };
  }

  return { nodes };
}

export function buildUpstreamContext(node, resultsByNodeId, swarmCfg = {}) {
  const deps = node.dependsOn || [];
  if (!deps.length) return "";
  const { upstream } = handoffLimits(swarmCfg);
  const blocks = [];
  for (const d of deps) {
    const r = resultsByNodeId.get(d);
    if (!r) continue;
    const body = truncateWithMarker(
      String(r.text || r.error || "").trim(),
      upstream,
      "upstreamMaxChars"
    );
    blocks.push(
      `### ${d} (${r.role || "task"} · ${r.status}${r.ok ? "" : " · FAILED"})\n${body || "(empty)"}`
    );
  }
  if (!blocks.length) return "";
  return (
    "Upstream results (from dependencies — treat as hints; verify with tools if acting):\n\n" +
    blocks.join("\n\n") +
    "\n\n"
  );
}

function depsTerminalOk(node, state) {
  for (const d of node.dependsOn || []) {
    const st = state.get(d);
    if (!st || st === "pending" || st === "running") return false;
  }
  return true;
}

function depsAllSucceeded(node, resultsByNodeId) {
  for (const d of node.dependsOn || []) {
    const r = resultsByNodeId.get(d);
    if (!r || !r.ok) return false;
  }
  return true;
}

/** Codes that warrant a node-level retry */
const RETRYABLE_NODE_CODES = new Set([
  "SPAWN_FAILED",
  "TIMEOUT",
]);

/**
 * Exponential backoff strategies (ms).
 *
 * attempt is 1-based (first retry after failure uses attempt=1).
 *
 * Strategies:
 * - exponential  — base * 2^(attempt-1), capped (no jitter)
 * - full         — random(0, exp)          (AWS "full jitter")
 * - equal        — exp/2 + random(0, exp/2)
 * - decorrelated — random(base, prev*3)    (default; spreads load)
 * - none         — 0
 *
 * Optional Retry-After: if opts.retryAfterMs set, use max(computed, retryAfter)
 * with small jitter when opts.respectRetryAfter !== false.
 *
 * @param {number} attempt
 * @param {{
 *   strategy?: string,
 *   baseMs?: number,
 *   capMs?: number,
 *   prevDelayMs?: number,
 *   retryAfterMs?: number|null,
 *   respectRetryAfter?: boolean,
 *   retryAfterJitterRatio?: number,
 * }} [opts]
 */
export function retryBackoffMs(attempt, opts = {}) {
  const strategy = String(opts.strategy || "decorrelated").toLowerCase();
  const base = Math.max(0, Number(opts.baseMs) || 500);
  const cap = Math.max(base, Number(opts.capMs) || 15_000);
  const a = Math.max(1, Number(attempt) || 1);

  if (strategy === "none") return 0;

  const exp = Math.min(cap, base * Math.pow(2, a - 1));
  let delay;

  switch (strategy) {
    case "exponential":
    case "expo":
      delay = exp;
      break;
    case "full":
      // uniform [0, exp]
      delay = Math.floor(Math.random() * (exp + 1));
      break;
    case "equal":
      // exp/2 + uniform[0, exp/2]
      delay = Math.floor(exp / 2 + Math.random() * (exp / 2 + 1));
      break;
    case "decorrelated":
    default: {
      // AWS decorrelated jitter: min(cap, rand(base, prev*3))
      const prev =
        opts.prevDelayMs != null
          ? Number(opts.prevDelayMs)
          : Math.min(cap, base * Math.pow(2, Math.max(0, a - 2)));
      const low = base;
      const high = Math.min(cap, Math.max(low, (prev || base) * 3));
      delay = Math.floor(low + Math.random() * (high - low + 1));
      break;
    }
  }

  delay = Math.min(cap, Math.max(0, delay));

  // Optional Retry-After (e.g. from provider 429)
  if (
    opts.respectRetryAfter !== false &&
    opts.retryAfterMs != null &&
    Number(opts.retryAfterMs) > 0
  ) {
    let ra = Number(opts.retryAfterMs);
    const ratio = Number(opts.retryAfterJitterRatio);
    if (Number.isFinite(ratio) && ratio > 0) {
      const j = ra * ratio;
      ra = ra + (Math.random() * 2 - 1) * j;
    }
    delay = Math.min(cap, Math.max(delay, Math.floor(ra)));
  }

  return delay;
}

/** List of supported strategy ids */
export const BACKOFF_STRATEGIES = [
  "exponential",
  "full",
  "equal",
  "decorrelated",
  "none",
];

export function isRetryableNodeResult(result) {
  if (!result || result.ok) return false;
  if (result.code === "ABORTED") return false;
  if (result.status === "skipped") return false;
  if (result.code && RETRYABLE_NODE_CODES.has(result.code)) return true;
  // Transient network-ish messages
  const err = String(result.error || "");
  if (/ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|503|429/i.test(err)) {
    return true;
  }
  return false;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const t = setTimeout(resolve, ms);
    if (t.unref) t.unref();
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

/**
 * Single attempt: spawn one subagent for a graph node.
 */

/** S1: persist a skipped/failed-dep node as a receipt (no spawn). */
async function recordSkippedNode(cfg, run, node, skipRes, goal) {
  try {
    await attachNodeReceipt(cfg, skipRes, {
      swarmId: run.id,
      nodeId: node.id,
      goal,
      toolTrace: [],
    });
  } catch (e) {
    skipRes.receiptError = e.message || String(e);
  }
  return skipRes;
}

async function runNodeOnce(cfg, swarmCfg, run, node, goal, resultsByNodeId, input) {
  const roleName = String(node.role || "research").toLowerCase();
  const role = ROLES[roleName] || ROLES.research;
  const roleOverride = swarmCfg.roles?.[roleName] || {};
  const maxTurns =
    node.maxTurns ?? roleOverride.maxTurns ?? role.maxTurns ?? 6;
  const useWorktree =
    node.worktree === true ||
    roleOverride.requireWorktree === true ||
    (role.worktree &&
      node.worktree !== false &&
      roleOverride.requireWorktree !== false);

  const upstream = buildUpstreamContext(node, resultsByNodeId, swarmCfg);
  const taskText =
    (role.promptPrefix || "") +
    (goal ? `Overall goal: ${goal}\n\n` : "") +
    upstream +
    `Subtask (${node.id}): ${node.task}`;

  let out;
  try {
    if (input.signal?.aborted) {
      throw new Error("aborted");
    }
    // Tests may inject input.spawnSubagent to avoid real agent loops
    const spawn = input.spawnSubagent || spawnSubagent;
    out = await spawn({
      task: taskText,
      maxTurns,
      worktree: useWorktree,
      isolateWorkspace:
        !useWorktree && (node.isolateWorkspace ?? role.isolateWorkspace),
      cfg,
      parentId: input.parentId || run.id,
      swarmId: run.id,
      workingDir: input.workingDir,
      approvalGate: input.approvalGate,
      signal: input.signal,
      timeoutMs:
        input.timeoutMs ?? swarmCfg.subagentTimeoutMs ?? 300_000,
      onEvent: input.onEvent,
      // C2: fabric role bound at spawn (trusted)
      role: roleName,
      swarmRole: roleName,
    });
  } catch (e) {
    const msg = e.message || String(e);
    const isAbort = /abort/i.test(msg);
    return {
      nodeId: node.id,
      role: roleName,
      task: node.task,
      id: null,
      ok: false,
      status: "error",
      text: "",
      error: msg,
      code: isAbort ? "ABORTED" : "SPAWN_FAILED",
      turns: null,
      workspace: null,
      dependsOn: node.dependsOn || [],
      attempts: 1,
    };
  }

  return {
    nodeId: node.id,
    role: roleName,
    task: node.task,
    id: out.id,
    ok: Boolean(out.ok),
    status: out.status || (out.ok ? "done" : "error"),
    text: out.result?.text || out.error || "",
    error: out.error || null,
    code: out.ok
      ? null
      : out.status === "timeout"
        ? "TIMEOUT"
        : "SPAWN_FAILED",
    turns: out.result?.turns,
    workspace: out.result?.workspace || out.workspace,
    worktree: out.result?.worktree || out.worktree || null,
    sessionId: out.result?.sessionId || null,
    fabricRole: out.result?.fabricRole || out.fabricRole || null,
    toolTrace: out.result?.toolTrace || [],
    dependsOn: node.dependsOn || [],
    attempts: 1,
  };
}

/**
 * Run node with retries for transient failures.
 */
async function runNode(cfg, swarmCfg, run, node, goal, resultsByNodeId, input) {
  const roleName = String(node.role || "research").toLowerCase();
  // retries = extra attempts after the first (default 2 → 3 total)
  const configuredRetries = Number(
    node.retries ?? input.retries ?? swarmCfg.nodeRetries ?? 2
  );
  const attemptsTotal = Math.max(
    1,
    Math.min(5, (Number.isFinite(configuredRetries) ? configuredRetries : 2) + 1)
  );

  const backoffOpts = {
    strategy: swarmCfg.retryStrategy || "decorrelated",
    baseMs: swarmCfg.retryBaseMs ?? 500,
    capMs: swarmCfg.retryCapMs ?? 15_000,
    respectRetryAfter: swarmCfg.respectRetryAfter !== false,
    retryAfterJitterRatio: swarmCfg.retryAfterJitterRatio ?? 0.1,
  };

  input.onEvent?.({
    type: "swarm",
    phase: "child_start",
    swarmId: run.id,
    nodeId: node.id,
    role: roleName,
    task: node.task,
    dependsOn: node.dependsOn || [],
    maxAttempts: attemptsTotal,
    retryStrategy: backoffOpts.strategy,
  });

  let last = null;
  let prevDelayMs = null;
  for (let attempt = 1; attempt <= attemptsTotal; attempt++) {
    if (input.signal?.aborted) {
      last = {
        nodeId: node.id,
        role: roleName,
        task: node.task,
        id: null,
        ok: false,
        status: "error",
        text: "",
        error: "aborted",
        code: "ABORTED",
        attempts: attempt,
        dependsOn: node.dependsOn || [],
      };
      break;
    }

    last = await runNodeOnce(
      cfg,
      swarmCfg,
      run,
      node,
      goal,
      resultsByNodeId,
      input
    );
    last.attempts = attempt;

    if (last.ok) {
      try {
        await attachNodeReceipt(cfg, last, {
          swarmId: run.id,
          nodeId: node.id,
          goal,
          fabricRole: last.fabricRole || last.result?.fabricRole,
          toolTrace: last.toolTrace || last.result?.toolTrace,
          successCriteria: node.successCriteria || node.criteria,
        });
      } catch (e) {
        last.receiptError = e.message || String(e);
      }
      input.onEvent?.({
        type: "swarm",
        phase: "child_done",
        swarmId: run.id,
        nodeId: node.id,
        status: last.status,
        ok: true,
        attempts: attempt,
        receiptId: last.receiptId || null,
      });
      return last;
    }

    const canRetry =
      attempt < attemptsTotal && isRetryableNodeResult(last);
    if (!canRetry) {
      try {
        await attachNodeReceipt(cfg, last, {
          swarmId: run.id,
          nodeId: node.id,
          goal,
          toolTrace: last.toolTrace || last.result?.toolTrace,
          successCriteria: node.successCriteria || node.criteria,
        });
      } catch (e) {
        last.receiptError = e.message || String(e);
      }
      input.onEvent?.({
        type: "swarm",
        phase: "child_done",
        swarmId: run.id,
        nodeId: node.id,
        status: last.status,
        ok: false,
        code: last.code,
        attempts: attempt,
        receiptId: last.receiptId || null,
      });
      return last;
    }

    // Parse Retry-After from error text if present (seconds or HTTP-date skipped → seconds only)
    let retryAfterMs = null;
    const raMatch = String(last.error || "").match(
      /retry-after[:\s]+(\d+)/i
    );
    if (raMatch) retryAfterMs = Number(raMatch[1]) * 1000;

    const delay = retryBackoffMs(attempt, {
      ...backoffOpts,
      prevDelayMs,
      retryAfterMs,
    });
    prevDelayMs = delay;

    input.onEvent?.({
      type: "swarm",
      phase: "child_retry",
      swarmId: run.id,
      nodeId: node.id,
      attempt,
      nextAttempt: attempt + 1,
      maxAttempts: attemptsTotal,
      delayMs: delay,
      strategy: backoffOpts.strategy,
      code: last.code,
      error: last.error,
    });
    try {
      await sleep(delay, input.signal);
    } catch {
      last.code = "ABORTED";
      last.error = "aborted during retry backoff";
      last.status = "error";
      break;
    }
  }

  // Final failure after retries exhausted (or aborted mid-backoff)
  if (last) {
    try {
      await attachNodeReceipt(cfg, last, {
        swarmId: run.id,
        nodeId: node.id,
        goal,
        toolTrace: last.toolTrace || last.result?.toolTrace,
        successCriteria: node.successCriteria || node.criteria,
      });
    } catch (e) {
      last.receiptError = e.message || String(e);
    }
  }
  input.onEvent?.({
    type: "swarm",
    phase: "child_done",
    swarmId: run.id,
    nodeId: node.id,
    status: last?.status,
    ok: false,
    code: last?.code,
    attempts: last?.attempts,
    receiptId: last?.receiptId || null,
  });
  return last;
}

/**
 * S2 DAG scheduler (also handles flat S1 graphs).
 *
 * @param {object} cfg
 * @param {object} input
 */

/**
 * A — After a successful implement node, merge its worktree into main
 * so dependent nodes (verify) see the files on the real project tree.
 * @returns {Promise<object|null>} merge detail or null if skipped
 */
export async function mergeImplementNodeEarly(cfg, result, input = {}, onEvent) {
  if (!result?.ok) return null;
  if (String(result.role || "").toLowerCase() !== "implement") return null;

  const wt =
    result.workspace ||
    result.worktree?.path ||
    result.result?.worktree?.path ||
    result.result?.workspace;
  if (!wt) return null;

  const main = path.resolve(String(input.workingDir || process.cwd()));
  const wtPath = path.resolve(String(wt));
  if (wtPath === main) {
    return { ok: true, skipped: true, method: "same-tree", nodeId: result.nodeId };
  }

  // CRITICAL: do NOT force autoMerge:true — that made prod guards dead code (design review P0).
  // Early merge only when policy allows OR operator explicitly opts in.
  const policy = resolveMergePolicy(cfg, input);
  const explicitEarly =
    input.autoMerge === true ||
    input.earlyMergeImplement === true ||
    cfg?.swarm?.earlyMergeImplement === true;
  if (!policy.autoMerge && !explicitEarly) {
    return {
      ok: true,
      skipped: true,
      method: "autoMerge-off",
      nodeId: result.nodeId,
      policy: { autoMerge: policy.autoMerge, profile: cfg?.profile || null },
    };
  }

  onEvent?.({
    type: "swarm",
    phase: "merge_early_check",
    nodeId: result.nodeId,
    worktreePath: wtPath,
    repoDir: main,
  });

  const check = await applyWorktreeMerge(main, wtPath, {
    checkOnly: true,
    useIndex: Boolean(policy.useIndex),
  });
  if (!check.ok) {
    onEvent?.({
      type: "swarm",
      phase: "merge_early_conflict",
      nodeId: result.nodeId,
      error: check.error,
      code: check.code || null,
    });
    return {
      ok: false,
      nodeId: result.nodeId,
      phase: "check",
      code: check.code || null,
      error: check.error,
      conflicts: check.conflicts,
    };
  }
  if (check.method === "noop" || check.method === "copy-untracked-check" && !(check.copied || []).length && check.stat === "no changes") {
    // still try apply for copy-untracked-check with files
  }

  const apply = await applyWorktreeMerge(main, wtPath, {
    checkOnly: false,
    useIndex: Boolean(policy.useIndex),
  });
  onEvent?.({
    type: "swarm",
    phase: apply.ok ? "merge_early_applied" : "merge_early_failed",
    nodeId: result.nodeId,
    method: apply.method,
    copied: apply.copied,
    error: apply.error,
    code: apply.code || null,
  });

  if (apply.ok && policy.cleanupWorktree) {
    await removeWorktree(main, wtPath).catch(() => {});
  }

  return {
    ok: Boolean(apply.ok),
    nodeId: result.nodeId,
    method: apply.method,
    code: apply.code || null,
    copied: apply.copied || [],
    error: apply.error || null,
    early: true,
  };
}

export async function runSwarmFanOut(cfg, input = {}) {
  const swarmCfg = cfg?.swarm || {};
  if (swarmCfg.enabled === false) {
    return swarmError("SWARM_DISABLED", "swarm.enabled is false", {
      hint: SWARM_ERROR_HINTS.SWARM_DISABLED,
    });
  }

  // Depth guard: a swarm child (cfg carries _spawnDepth) may not fan out past
  // swarm.maxSpawnDepth (default 2) — stops runaway recursive swarms.
  const spawnDepth = Number(swarmCfg._spawnDepth ?? 0) || 0;
  const maxSpawnDepth = Math.max(0, Number(swarmCfg.maxSpawnDepth ?? 2) || 2);
  if (spawnDepth >= maxSpawnDepth) {
    return swarmError(
      "SPAWN_DEPTH_EXCEEDED",
      `spawn depth ${spawnDepth} >= swarm.maxSpawnDepth ${maxSpawnDepth}`,
      {
        depth: spawnDepth,
        maxSpawnDepth,
        hint: SWARM_ERROR_HINTS.SPAWN_DEPTH_EXCEEDED,
      }
    );
  }

  const { maxParallel, maxChildren } = resolveSwarmCaps(swarmCfg);
  /** @type {'skip-downstream'|'fail-fast'|'best-effort'} */
  const onDepFail =
    input.onDepFail ||
    swarmCfg.onDepFail ||
    "skip-downstream";
  if (
    !["skip-downstream", "fail-fast", "best-effort"].includes(onDepFail)
  ) {
    return swarmError(
      "INVALID_POLICY",
      `invalid onDepFail: ${onDepFail}`,
      { onDepFail, hint: SWARM_ERROR_HINTS.INVALID_POLICY }
    );
  }

  if (input.signal?.aborted) {
    return swarmError("ABORTED", "swarm aborted before start", {
      hint: SWARM_ERROR_HINTS.ABORTED,
    });
  }

  const goal = String(input.goal || "").trim();
  const norm = normalizeTaskGraph(input.tasks);
  if (norm.error) {
    return swarmError(norm.code || "TASKS_REQUIRED", norm.error, norm.details || {});
  }
  const { nodes } = norm;
  if (nodes.length > maxChildren) {
    return swarmError(
      "TOO_MANY_TASKS",
      `too many tasks (${nodes.length}); maxNodes=${maxChildren}`,
      {
        count: nodes.length,
        maxChildrenPerRun: maxChildren,
        hint: SWARM_ERROR_HINTS.TOO_MANY_TASKS,
      }
    );
  }

  let waves;
  try {
    waves = topologicalWaves(nodes);
  } catch (e) {
    const msg = e.message || String(e);
    return swarmError(
      /cycle/i.test(msg) ? "CYCLE" : "UNKNOWN_DEP",
      msg,
      { hint: SWARM_ERROR_HINTS.CYCLE }
    );
  }

  let run;
  if (input._resumeRun) {
    run = input._resumeRun;
    try {
      await updateSwarmRun(cfg, run.id, { status: "running", finishedAt: null });
    } catch {
      /* resume proceeds even if the status refresh fails */
    }
  } else {
    try {
      run = await createSwarmRun(cfg, {
        goal,
        status: "running",
        parentSession: input.parentId || null,
        budget: { maxParallel, maxChildren },
        policy: {
          isolation: swarmCfg.defaultIsolation || "worktree",
          onDepFail,
          waves: waves.length,
        },
        graph: nodes.map((n) => ({
          id: n.id,
          role: n.role,
          task: n.task,
          dependsOn: n.dependsOn,
          status: "pending",
        })),
        children: [],
      });
    } catch (e) {
      return swarmError("PERSIST_FAILED", e.message || String(e), {
        phase: "createSwarmRun",
        hint: SWARM_ERROR_HINTS.PERSIST_FAILED,
      });
    }
  }

  // Append-only resume journal (advisory — write errors warn, never fail the run)
  const journal = createRunJournal(cfg, run.id, {
    onWarn: (e) =>
      input.onEvent?.({
        type: "swarm",
        phase: "journal_warn",
        swarmId: run.id,
        error: e?.message || String(e),
      }),
  });
  if (input._resumeRun) {
    journal.append({
      type: "resume",
      runId: run.id,
      replayed: [...(input._preloadedResults?.keys?.() || [])],
    });
  } else {
    journal.append({
      type: "run_start",
      runId: run.id,
      goal,
      graphHash: computeGraphHash(goal, nodes),
      nodes: nodes.map((n) => ({ id: n.id, role: n.role, dependsOn: n.dependsOn })),
    });
  }

  input.onEvent?.({
    type: "swarm",
    phase: "swarm_start",
    swarmId: run.id,
    goal,
    nodeCount: nodes.length,
    waves: waves.length,
    maxParallel,
    onDepFail,
  });

  /** @type {Map<string, string>} */
  const state = new Map(nodes.map((n) => [n.id, "pending"]));
  /** @type {Map<string, object>} */
  const resultsByNodeId = new Map();
  const childIds = [];
  const results = [];

  // Resume: replay terminal ok results — those nodes are "done" and the wave
  // scheduler (which only dispatches "pending") re-runs everything else.
  if (input._preloadedResults instanceof Map) {
    for (const [nodeId, r] of input._preloadedResults) {
      if (!state.has(nodeId)) continue;
      state.set(nodeId, "done");
      resultsByNodeId.set(nodeId, r);
      results.push(r);
      if (r.id) childIds.push(r.id);
    }
  }

  const persistGraph = async () => {
    try {
      await updateSwarmRun(cfg, run.id, {
        graph: nodes.map((n) => ({
          id: n.id,
          role: n.role,
          task: n.task,
          dependsOn: n.dependsOn,
          status: state.get(n.id) || "pending",
          childId: resultsByNodeId.get(n.id)?.id || null,
          ok: resultsByNodeId.get(n.id)?.ok ?? null,
          error: resultsByNodeId.get(n.id)?.error || null,
          code: resultsByNodeId.get(n.id)?.code || null,
        })),
        children: childIds,
      });
    } catch (e) {
      console.warn(
        "[xclaw:swarm] persistGraph failed:",
        e.message || e
      );
    }
  };

  let abortRemaining = false;

  function skipAllPending(reason) {
    for (const m of nodes) {
      if (state.get(m.id) !== "pending") continue;
      state.set(m.id, "skipped");
      if (resultsByNodeId.has(m.id)) continue;
      const sr = {
        nodeId: m.id,
        role: m.role,
        task: m.task,
        id: null,
        ok: false,
        status: "skipped",
        text: "",
        error: reason,
        dependsOn: m.dependsOn || [],
      };
      resultsByNodeId.set(m.id, sr);
      results.push(sr);
      journal.append({ type: "node_result", nodeId: m.id, result: sr });
    }
  }

  let abortedBySignal = false;

  for (let wi = 0; wi < waves.length; wi++) {
    if (abortRemaining) break;
    if (input.signal?.aborted) {
      abortedBySignal = true;
      skipAllPending("skipped: aborted by client signal");
      input.onEvent?.({
        type: "swarm",
        phase: "swarm_aborted",
        swarmId: run.id,
        waveIndex: wi,
        reason: "signal",
      });
      break;
    }
    const wave = waves[wi];
    input.onEvent?.({
      type: "swarm",
      phase: "wave_start",
      swarmId: run.id,
      waveIndex: wi,
      waveSize: wave.length,
      nodeIds: wave.map((n) => n.id),
      totalWaves: waves.length,
    });
    const toRun = [];

    for (const n of wave) {
      const st = state.get(n.id);
      if (st !== "pending") continue;

      if (!depsTerminalOk(n, state)) {
        state.set(n.id, "skipped");
        const skipRes = {
          nodeId: n.id,
          role: n.role,
          task: n.task,
          id: null,
          ok: false,
          status: "skipped",
          code: "DEPS_NOT_TERMINAL",
          text: "",
          error: "dependencies not terminal",
          dependsOn: n.dependsOn || [],
        };
        await recordSkippedNode(cfg, run, n, skipRes, goal);
        resultsByNodeId.set(n.id, skipRes);
        results.push(skipRes);
        journal.append({ type: "node_result", nodeId: n.id, result: skipRes });
        continue;
      }

      if (onDepFail !== "best-effort" && !depsAllSucceeded(n, resultsByNodeId)) {
        state.set(n.id, "skipped");
        const failedDeps = (n.dependsOn || []).filter((d) => {
          const r = resultsByNodeId.get(d);
          return r && !r.ok;
        });
        const skipRes = {
          nodeId: n.id,
          role: n.role,
          task: n.task,
          id: null,
          ok: false,
          status: "skipped",
          code: "UPSTREAM_FAILED",
          text: "",
          error: `skipped: upstream failed (${failedDeps.join(", ") || "deps"})`,
          dependsOn: n.dependsOn || [],
          failedDeps,
        };
        await recordSkippedNode(cfg, run, n, skipRes, goal);
        resultsByNodeId.set(n.id, skipRes);
        results.push(skipRes);
        journal.append({ type: "node_result", nodeId: n.id, result: skipRes });
        input.onEvent?.({
          type: "swarm",
          phase: "child_skipped",
          swarmId: run.id,
          nodeId: n.id,
          reason: skipRes.error,
          receiptId: skipRes.receiptId || null,
        });
        if (onDepFail === "fail-fast") {
          skipAllPending("skipped: fail-fast after upstream error");
          abortRemaining = true;
          break;
        }
        continue;
      }

      toRun.push(n);
    }

    if (abortRemaining) {
      await persistGraph();
      break;
    }

    // Run wave with concurrency ≤ maxParallel
    for (let i = 0; i < toRun.length; i += maxParallel) {
      const batch = toRun.slice(i, i + maxParallel);
      for (const n of batch) {
        state.set(n.id, "running");
        journal.append({ type: "node_start", nodeId: n.id });
      }
      await persistGraph();

      const batchResults = await Promise.all(
        batch.map((n) =>
          runNode(cfg, swarmCfg, run, n, goal, resultsByNodeId, input)
        )
      );

      for (const r of batchResults) {
        state.set(
          r.nodeId,
          r.ok ? "done" : r.status === "timeout" ? "timeout" : "error"
        );
        // A: merge implement worktree before dependents in later waves
        if (r.ok && String(r.role || "").toLowerCase() === "implement") {
          try {
            const early = await mergeImplementNodeEarly(
              cfg,
              r,
              input,
              input.onEvent
            );
            if (early) {
              r.earlyMerge = early;
              if (early.ok && !early.skipped) {
                r.mergedToMain = true;
              }
            }
          } catch (e) {
            r.earlyMerge = {
              ok: false,
              error: e.message || String(e),
              early: true,
            };
            input.onEvent?.({
              type: "swarm",
              phase: "merge_early_failed",
              nodeId: r.nodeId,
              error: r.earlyMerge.error,
            });
          }
        }
        resultsByNodeId.set(r.nodeId, r);
        results.push(r);
        if (r.id) childIds.push(r.id);
        journal.append({
          type: "node_result",
          nodeId: r.nodeId,
          result: slimResultForJournal(r),
        });
      }
      await persistGraph();

      if (onDepFail === "fail-fast") {
        const hardFail = batchResults.some(
          (r) => !r.ok && r.status !== "skipped"
        );
        if (hardFail) {
          skipAllPending("skipped: fail-fast after upstream error");
          abortRemaining = true;
          await persistGraph();
          break;
        }
      }
    }
  }

  // Ensure every node has a result
  for (const n of nodes) {
    if (!resultsByNodeId.has(n.id)) {
      const st = state.get(n.id) || "skipped";
      const r = {
        nodeId: n.id,
        role: n.role,
        task: n.task,
        id: null,
        ok: false,
        status: st,
        text: "",
        error: "not executed",
        dependsOn: n.dependsOn || [],
      };
      resultsByNodeId.set(n.id, r);
      results.push(r);
      state.set(n.id, st);
    }
  }

  const graphForViz = nodes.map((n) => ({
    id: n.id,
    role: n.role,
    task: n.task,
    dependsOn: n.dependsOn,
    status: state.get(n.id) || "pending",
  }));

  const okCount = results.filter((r) => r.ok).length;
  const skipCount = results.filter((r) => r.status === "skipped").length;
  const failCount = results.filter(
    (r) => !r.ok && r.status !== "skipped"
  ).length;

  const ascii = toAsciiWaves(graphForViz, {
    title: `Swarm ${run.id.slice(0, 8)}`,
  });

  const parts = [
    `# Swarm join summary`,
    `Goal: ${goal || "(none)"}`,
    `Swarm id: ${run.id}`,
    `Nodes: ${results.length} · ok=${okCount} · failed=${failCount} · skipped=${skipCount}`,
    `Waves: ${waves.length} · onDepFail=${onDepFail}`,
    ``,
    "```",
    ascii,
    "```",
    ``,
  ];

  // Stable order by original node list
  for (const n of nodes) {
    const r = resultsByNodeId.get(n.id);
    if (!r) continue;
    parts.push(`## [${n.id}] ${r.role}: ${r.task}`);
    parts.push(
      `Status: ${r.status}${r.ok ? "" : r.status === "skipped" ? " · SKIPPED" : " · ERROR"}`
    );
    if (r.dependsOn?.length) {
      parts.push(`Depends on: ${r.dependsOn.join(", ")}`);
    }
    parts.push(
      truncateWithMarker(
        String(r.text || r.error || ""),
        handoffLimits(swarmCfg).result,
        "resultMaxChars"
      )
    );
    parts.push("");
  }

  // Structured majority vote (research ballots)
  let voteReport = null;
  if (swarmCfg.voteEnabled !== false) {
    try {
      voteReport = structuredMajorityVote(results, {
        roles: swarmCfg.voteRoles || ["research"],
        minBallots: swarmCfg.voteMinBallots ?? 2,
        minShare: swarmCfg.voteMinShare ?? 0.5,
        fields: swarmCfg.voteFields || undefined,
        tieBreak: swarmCfg.voteTieBreak || "confidence",
        preferValues: swarmCfg.votePreferValues || undefined,
        roleWeights: swarmCfg.voteRoleWeights || undefined,
        seed: run.id,
        requireReceipts: receiptsRequired(cfg, input),
      });
      if (voteReport.validBallots > 0 || voteReport.parseFailures > 0) {
        parts.push(formatVoteReport(voteReport));
      }
    } catch (e) {
      parts.push(`## Structured majority vote\nError: ${e.message}\n`);
    }
  }

  // S3 — safe worktree merge (check → auto or pending approval)
  let mergeReport = null;
  const mergeEnabled = swarmCfg.mergeEnabled !== false;
  if (mergeEnabled && okCount > 0) {
    try {
      mergeReport = await planAndMaybeMerge(cfg, {
        swarmId: run.id,
        repoDir: input.workingDir || process.cwd(),
        results: nodes.map((n) => resultsByNodeId.get(n.id)).filter(Boolean),
        input: {
          autoMerge: input.autoMerge,
          requireReceipts: input.requireReceipts ?? receiptsRequired(cfg, input),
        },
        onEvent: input.onEvent,
      });
      if (mergeReport?.status && mergeReport.status !== "noop") {
        parts.push(`## Merge (${mergeReport.status})`);
        parts.push(mergeReport.message || "");
        if (mergeReport.proposalId) {
          parts.push(
            `Proposal id: \`${mergeReport.proposalId}\` — approve with xclaw_swarm_merge_approve`
          );
        }
        for (const it of mergeReport.items || []) {
          parts.push(
            `- ${it.nodeId}: check=${it.checkOk ? "ok" : "FAIL"} applied=${Boolean(it.applied)}${it.checkError || it.applyError ? " · " + (it.checkError || it.applyError) : ""}`
          );
        }
        parts.push("");
      }
    } catch (e) {
      mergeReport = {
        status: "error",
        message: e.message || String(e),
      };
      parts.push(`## Merge error`);
      parts.push(mergeReport.message);
      parts.push("");
    }
  }

  const summary = parts.join("\n");
  const status = abortedBySignal
    ? "aborted"
    : failCount === 0 && skipCount === 0
      ? "done"
      : okCount === 0
        ? "error"
        : "partial";

  await updateSwarmRun(cfg, run.id, {
    status,
    children: childIds,
    finishedAt: new Date().toISOString(),
    receiptSummary: buildRunReceiptSummary(results),
    summary: summary.slice(0, 12000),
    graph: graphForViz.map((n) => ({
      ...n,
      childId: resultsByNodeId.get(n.id)?.id || null,
      ok: resultsByNodeId.get(n.id)?.ok ?? null,
      error: resultsByNodeId.get(n.id)?.error || null,
    })),
    results: nodes.map((n) => {
      const r = resultsByNodeId.get(n.id);
      return {
        nodeId: n.id,
        id: r?.id || null,
        role: r?.role,
        status: r?.status,
        ok: r?.ok,
        receiptId: r?.receiptId || null,
        receiptPath: r?.receiptPath || null,
      };
    }),
    ascii,
    mermaid: toMermaid(graphForViz),
    dot: toDot(graphForViz, { title: goal || "Swarm" }),
    merge: mergeReport
      ? {
          status: mergeReport.status,
          proposalId: mergeReport.proposalId || null,
          message: mergeReport.message || null,
        }
      : null,
    vote: voteReport
      ? {
          ok: voteReport.ok,
          consensus: voteReport.consensus,
          stats: voteReport.stats,
          validBallots: voteReport.validBallots,
        }
      : null,
  });

  const receiptSummary = buildRunReceiptSummary(results);
  const receiptPolicy = evaluateReceiptPolicy(results, {
    require: receiptsRequired(cfg, input),
  });

  const finalResult = {
    ok: status !== "error" && status !== "aborted",
    status,
    swarmId: run.id,
    children: childIds,
    results,
    graph: graphForViz,
    waves: waves.length,
    summary,
    ascii,
    merge: mergeReport,
    vote: voteReport,
    receiptSummary,
    receipts: receiptPolicy,
  };

  input.onEvent?.({
    type: "swarm",
    phase: "swarm_done",
    swarmId: run.id,
    status,
    ok: finalResult.ok,
    aborted: Boolean(abortedBySignal || input.signal?.aborted),
    okCount,
    failCount,
    skipCount,
  });

  await journal.flush();
  return finalResult;
}

/**
 * Resume an interrupted swarm run from its journal.
 *
 * Replays terminal ok node results (a node whose LAST journaled terminal
 * entry is not ok gets re-run), verifies the journal's graph hash against the
 * graph reconstructed from the run record (a journal can never drive a
 * different graph), then re-enters the shared wave scheduler — only nodes
 * still "pending" execute.
 *
 * @param {object} cfg
 * @param {string} runId
 * @param {object} [opts] forwarded to runSwarmFanOut (onEvent, workingDir,
 *   signal, autoMerge, spawnSubagent for tests, …)
 */
export async function resumeSwarmRun(cfg, runId, opts = {}) {
  const run = await getSwarmRun(cfg, runId);
  if (!run) {
    return {
      ok: false,
      code: "RUN_NOT_FOUND",
      error: `swarm run not found: ${runId}`,
    };
  }
  const entries = await readJournal(cfg, runId);
  if (!entries || !entries.length) {
    return {
      ok: false,
      code: "JOURNAL_NOT_FOUND",
      error: `no journal for run ${runId} (runs before 3.84.0 have none)`,
    };
  }
  const header = entries.find((e) => e.type === "run_start");
  if (!header || !header.graphHash) {
    return {
      ok: false,
      code: "JOURNAL_NOT_FOUND",
      error: `journal for ${runId} has no run_start header`,
    };
  }

  const graph = Array.isArray(run.graph) ? run.graph : [];
  if (!graph.length) {
    return {
      ok: false,
      code: "JOURNAL_GRAPH_MISMATCH",
      error: `run record ${runId} has no graph to resume`,
    };
  }
  const tasks = graph.map((n) => ({
    id: n.id,
    task: n.task,
    role: n.role,
    dependsOn: n.dependsOn || [],
  }));
  const norm = normalizeTaskGraph(tasks);
  if (norm.error) {
    return {
      ok: false,
      code: "JOURNAL_GRAPH_MISMATCH",
      error: `stored graph no longer normalizes: ${norm.error}`,
    };
  }
  const actualHash = computeGraphHash(run.goal || "", norm.nodes);
  if (actualHash !== header.graphHash) {
    return {
      ok: false,
      code: "JOURNAL_GRAPH_MISMATCH",
      error: "journal graph hash does not match the run record's graph/goal",
      details: { journalHash: header.graphHash, runHash: actualHash },
    };
  }

  // Last terminal entry per node wins; only ok results are replayed.
  const preloaded = new Map();
  for (const e of entries) {
    if (e.type !== "node_result" || !e.nodeId || !e.result) continue;
    if (e.result.ok) preloaded.set(e.nodeId, e.result);
    else preloaded.delete(e.nodeId);
  }

  return runSwarmFanOut(cfg, {
    ...opts,
    goal: run.goal || "",
    tasks,
    onDepFail: opts.onDepFail || run.policy?.onDepFail,
    _resumeRun: run,
    _preloadedResults: preloaded,
  });
}

/**
 * Tool exposed to the parent agent.
 */
export function createSwarmRunTool(ctx = {}) {
  return {
    name: "xclaw_swarm_run",
    description:
      "Run a swarm of subagents. Tasks may be flat (parallel) or a DAG with id + dependsOn (S2). Roles: research|implement|verify|critic. Caps parallel workers. Downstream nodes receive upstream results. Failed deps skip downstream by default.",
    parameters: {
      type: "object",
      properties: {
        goal: { type: "string", description: "Overall goal for context" },
        tasks: {
          type: "array",
          description:
            "Subtasks: strings, or {id, task, role, dependsOn[]}. dependsOn = node ids that must finish first.",
          items: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  id: { type: "string" },
                  task: { type: "string" },
                  role: {
                    type: "string",
                    enum: ["research", "implement", "verify", "critic"],
                  },
                  dependsOn: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
              },
            ],
          },
        },
        onDepFail: {
          type: "string",
          enum: ["skip-downstream", "fail-fast", "best-effort"],
          description:
            "When a dependency fails: skip-downstream (default), fail-fast, or best-effort (still run)",
        },
        autoMerge: {
          type: "boolean",
          description:
            "If true, apply clean worktree patches to main after gates pass (lab). Prod should leave false and use xclaw_swarm_merge_approve.",
        },
      },
      required: ["tasks"],
    },
    async execute({ goal, tasks, onDepFail, autoMerge }) {
      let out;
      try {
        out = await runSwarmFanOut(ctx.cfg, {
          goal,
          tasks,
          onDepFail,
          autoMerge,
          parentId: ctx.sessionId || "parent",
          workingDir: ctx.workingDir,
          signal: ctx.signal,
          onEvent: ctx.onEvent,
        });
      } catch (e) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: false,
                  code: "SPAWN_FAILED",
                  error: e.message || String(e),
                  hint: SWARM_ERROR_HINTS.SPAWN_FAILED,
                  retryable: true,
                },
                null,
                2
              ),
            },
          ],
        };
      }
      if (!out.ok && out.error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: false,
                  code: out.code || "ERROR",
                  error: out.error,
                  retryable: Boolean(out.retryable),
                  details: out.details || {},
                  hint:
                    out.details?.hint ||
                    SWARM_ERROR_HINTS[out.code] ||
                    null,
                },
                null,
                2
              ),
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                swarmId: out.swarmId,
                status: out.status,
                waves: out.waves,
                children: out.children,
                graph: out.graph,
                merge: out.merge
                  ? {
                      status: out.merge.status,
                      proposalId: out.merge.proposalId,
                      message: out.merge.message,
                    }
                  : null,
                summary: out.summary,
              },
              null,
              2
            ),
          },
        ],
      };
    },
  };
}
