/**
 * Client-side context / "KV" eviction policies for XClaw.
 *
 * We do not control the provider's GPU KV cache. We *do* control the message
 * list sent each turn. Eviction here:
 *  - Never drops messages[0] (system prefix) — preserves prompt-cache hits
 *  - Preferentially shrinks or drops old tool results (largest volatile KV)
 *  - Keeps recent user/assistant turns for coherence
 *
 * Policies:
 *  - none          : no eviction
 *  - sliding_window: keep last N non-system messages
 *  - tool_lru      : truncate/drop oldest tool messages first under budget
 *  - hybrid        : tool_lru then sliding_window (default)
 */

import { truncateToolResult } from "../agent/truncate.mjs";
import { slidingWindowEvict } from "./sliding-window.mjs";
import { applyToolLruByScore } from "./tool-lru.mjs";

export const EVICTION_POLICIES = ["none", "sliding_window", "tool_lru", "hybrid"];

/**
 * Estimate chars of a message (fast, no tokenizer required).
 */
export function messageChars(msg) {
  if (!msg) return 0;
  if (typeof msg.content === "string") return msg.content.length;
  if (Array.isArray(msg.content)) {
    return msg.content.reduce((n, p) => n + (p?.text?.length || 0), 0);
  }
  if (msg.tool_calls) {
    return JSON.stringify(msg.tool_calls).length;
  }
  return 0;
}

/**
 * Apply eviction policy to a messages array (returns new array + report).
 *
 * @param {object[]} messages
 * @param {object} opts
 * @param {string} [opts.policy] hybrid|tool_lru|sliding_window|none
 * @param {number} [opts.maxMessages] max non-system messages to keep
 * @param {number} [opts.maxChars] approx char budget for whole transcript
 * @param {number} [opts.toolMaxChars] max chars per tool message after eviction pass
 * @param {number} [opts.protectRecent] recent messages never dropped (default 4)
 */
export function evictMessages(messages, opts = {}) {
  const policy = opts.policy || "hybrid";
  const maxMessages = opts.maxMessages ?? 40;
  const maxChars = opts.maxChars ?? 120_000;
  const toolMaxChars = opts.toolMaxChars ?? 2000;
  const protectRecent = opts.protectRecent ?? 4;

  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages: messages || [], report: { policy, actions: [] } };
  }

  if (policy === "none") {
    return {
      messages: [...messages],
      report: { policy, actions: [], totalChars: totalChars(messages) },
    };
  }

  // Always preserve index 0 if system
  const head = [];
  let rest = [...messages];
  if (rest[0]?.role === "system") {
    head.push(rest[0]);
    rest = rest.slice(1);
  }

  const actions = [];
  let working = rest;

  if (policy === "tool_lru" || policy === "hybrid") {
    const r = evictToolLru(working, {
      toolMaxChars,
      maxChars: Math.max(0, maxChars - totalChars(head)),
      protectRecent,
      lru: opts.lru || {},
      lastReport: opts.lastReport,
      prevWeights: opts.prevWeights,
      dualState: opts.dualState,
    });
    working = r.messages;
    actions.push(...r.actions);
    if (r.weights) opts._lastWeights = r.weights;
    if (r.dualState) opts._dualState = r.dualState;
    if (r.freePct != null) opts._lastEvictReport = {
      freePct: r.freePct,
      truncated: r.actions?.filter((a) => a.type === "truncate").length || 0,
      stubbed: r.actions?.filter((a) => a.type === "stub").length || 0,
      beforeChars: r.beforeChars,
      afterChars: r.afterChars,
    };
  }

  if (policy === "sliding_window" || policy === "hybrid") {
    // Re-attach prefix for sliding window API, then strip again
    const full = head.concat(working);
    const r = slidingWindowEvict(full, {
      maxMessages,
      maxChars: policy === "sliding_window" ? maxChars : null,
      protectRecent,
      pairAware: opts.pairAware !== false,
      insertSummary: opts.insertSummary !== false && policy === "sliding_window",
    });
    // Extract rest after any system prefix
    working = r.messages[0]?.role === "system" ? r.messages.slice(1) : r.messages;
    actions.push(...r.report.actions);
  }

  // Final char budget pass: if still over, aggressively shrink oldest tools
  if (totalChars(head) + totalChars(working) > maxChars) {
    const r = forceCharBudget(working, {
      budget: Math.max(0, maxChars - totalChars(head)),
      toolMaxChars: Math.min(toolMaxChars, 800),
      protectRecent,
    });
    working = r.messages;
    actions.push(...r.actions);
  }

  const out = head.concat(working);
  return {
    messages: out,
    report: {
      policy,
      actions,
      totalChars: totalChars(out),
      messageCount: out.length,
      dropped: actions.filter((a) => a.type === "drop" || a.type === "splice").length,
      truncated: actions.filter((a) => a.type === "truncate").length,
      stubbed: actions.filter((a) => a.type === "stub").length,
      weights: opts._lastWeights || null,
      dualState: opts._dualState || null,
      lastEvictReport: opts._lastEvictReport || null,
    },
  };
}

function totalChars(msgs) {
  return (msgs || []).reduce((n, m) => n + messageChars(m), 0);
}

/**
 * Oldest tool messages first: truncate to toolMaxChars, then drop if still needed.
 */
function evictToolLru(messages, {
  toolMaxChars,
  maxChars,
  protectRecent,
  lru = {},
  lastReport,
  prevWeights,
  dualState,
}) {
  const mode = lru.mode || "size_weighted";
  if (mode === "age_legacy") {
    return evictToolLruLegacy(messages, { toolMaxChars, maxChars, protectRecent });
  }

  const result = applyToolLruByScore(messages, {
    mode,
    toolMaxChars,
    maxChars,
    protectRecent,
    wAge: lru.wAge,
    wSize: lru.wSize,
    sizeTransform: lru.sizeTransform || "log",
    dynamic: lru.dynamic,
    lastReport,
    prevWeights,
    dualState,
    allowSplice: lru.allowSplice !== false,
  });

  return {
    messages: result.messages,
    actions: result.actions.map((a) => ({
      ...a,
      role: a.role || "tool",
    })),
    weights: result.weights,
    dualState: result.dualState,
    freePct: result.freePct,
    beforeChars: result.beforeChars,
    afterChars: result.afterChars,
  };
}

/** Original age-ordered truncate (no scoring). */
function evictToolLruLegacy(messages, { toolMaxChars, maxChars, protectRecent }) {
  const actions = [];
  const protectFrom = Math.max(0, messages.length - protectRecent);
  let msgs = messages.map((m) => ({ ...m }));

  for (let i = 0; i < protectFrom; i++) {
    if (msgs[i]?.role !== "tool") continue;
    const content = typeof msgs[i].content === "string" ? msgs[i].content : "";
    if (content.length <= toolMaxChars) continue;
    const trunc = truncateToolResult(content, {
      maxChars: toolMaxChars,
      headChars: Math.floor(toolMaxChars * 0.7),
      tailChars: Math.floor(toolMaxChars * 0.2),
    });
    msgs[i] = { ...msgs[i], content: trunc.text };
    actions.push({
      type: "truncate",
      index: i,
      role: "tool",
      originalChars: trunc.originalChars,
      keptChars: trunc.keptChars,
    });
  }

  while (totalChars(msgs) > maxChars) {
    let idx = -1;
    const pf = Math.max(0, msgs.length - protectRecent);
    for (let i = 0; i < pf; i++) {
      if (msgs[i]?.role === "tool") {
        idx = i;
        break;
      }
    }
    if (idx < 0) break;
    actions.push({
      type: "drop",
      role: "tool",
      chars: messageChars(msgs[idx]),
      tool_call_id: msgs[idx].tool_call_id,
    });
    msgs[idx] = {
      role: "tool",
      tool_call_id: msgs[idx].tool_call_id,
      content: "[evicted tool result]",
    };
    if (totalChars(msgs) > maxChars) {
      msgs.splice(idx, 1);
    }
    if (msgs.length <= protectRecent) break;
  }

  return { messages: msgs, actions };
}

function forceCharBudget(messages, { budget, toolMaxChars, protectRecent }) {
  const actions = [];
  let msgs = messages.map((m) => ({ ...m }));
  const protectFrom = Math.max(0, msgs.length - protectRecent);

  for (let i = 0; i < protectFrom && totalChars(msgs) > budget; i++) {
    if (msgs[i]?.role === "tool") {
      const content = typeof msgs[i].content === "string" ? msgs[i].content : "";
      if (content.length > 80) {
        const trunc = truncateToolResult(content, {
          maxChars: toolMaxChars,
          headChars: Math.floor(toolMaxChars * 0.7),
          tailChars: Math.floor(toolMaxChars * 0.15),
        });
        msgs[i] = { ...msgs[i], content: trunc.text };
        actions.push({ type: "truncate", index: i, role: "tool", forced: true });
      }
    }
  }
  return { messages: msgs, actions };
}

/**
 * Resolve options from cfg.tokens.eviction
 */
export function evictionOptsFromConfig(cfg = {}) {
  const e = cfg.tokens?.eviction || {};
  return {
    policy: e.policy || "hybrid",
    maxMessages: e.maxMessages ?? 40,
    maxChars: e.maxChars ?? 120_000,
    toolMaxChars: e.toolMaxChars ?? 2000,
    protectRecent: e.protectRecent ?? 4,
    pairAware: e.pairAware !== false,
    insertSummary: e.insertSummary !== false,
    enabled: e.enabled !== false,
    lru: {
      mode: e.lru?.mode || "size_weighted",
      wAge: e.lru?.wAge,
      wSize: e.lru?.wSize,
      sizeTransform: e.lru?.sizeTransform || "log",
      allowSplice: e.lru?.allowSplice !== false,
      dynamic: {
        enabled: e.lru?.dynamic?.enabled !== false,
        strategy: e.lru?.dynamic?.strategy || "pressure_skew",
        ema: e.lru?.dynamic?.ema ?? 0.3,
        wSizeMin: e.lru?.dynamic?.wSizeMin ?? 0.25,
        wSizeMax: e.lru?.dynamic?.wSizeMax ?? 0.9,
        dual: e.lru?.dynamic?.dual || {
          enabled: true,
          mode: "blend",
          alphaFast: 0.5,
          alphaSlow: 0.15,
          deadband: 0.05,
          betaMin: 0.25,
          betaMax: 0.85,
          confirmTurns: 2,
        },
      },
    },
  };
}
