/**
 * Client-side "KV / context" eviction policies for XClaw.
 *
 * We cannot control provider GPU KV caches directly. We *can* shape the
 * message list so that:
 *  - messages[0] system prefix stays intact (prefix cache)
 *  - old tool results / turns are dropped or compacted (suffix bound)
 *  - recent turns stay available for the model
 *
 * Policies: none | sliding | tool_first | token_budget | hybrid
 */

import { countChatTokens } from "./count.mjs";

export const EVICTION_POLICIES = [
  "none",
  "sliding",
  "tool_first",
  "token_budget",
  "hybrid",
];

/**
 * @typedef {object} EvictionConfig
 * @property {boolean} [enabled]
 * @property {"none"|"sliding"|"tool_first"|"token_budget"|"hybrid"} [policy]
 * @property {number} [maxMessages]        total messages including system
 * @property {number} [protectRecent]      newest messages never evicted (besides system)
 * @property {number} [maxHistoryTokens]   approx token budget for non-system messages
 * @property {number} [maxToolResultChars] hard cap when compacting tool msgs
 * @property {boolean} [compactTools]      shrink tool content instead of dropping when possible
 */

const DEFAULTS = {
  enabled: true,
  policy: "hybrid",
  maxMessages: 40,
  protectRecent: 8,
  maxHistoryTokens: 12000,
  maxToolResultChars: 1500,
  compactTools: true,
};

export function evictionConfigFromCfg(cfg = {}) {
  const e = cfg.tokens?.eviction || cfg.agent?.eviction || {};
  return {
    enabled: e.enabled !== false,
    policy: e.policy || DEFAULTS.policy,
    maxMessages: e.maxMessages ?? DEFAULTS.maxMessages,
    protectRecent: e.protectRecent ?? DEFAULTS.protectRecent,
    maxHistoryTokens: e.maxHistoryTokens ?? DEFAULTS.maxHistoryTokens,
    maxToolResultChars: e.maxToolResultChars ?? DEFAULTS.maxToolResultChars,
    compactTools: e.compactTools !== false,
  };
}

function isSystem(m) {
  return m?.role === "system";
}

function isTool(m) {
  return m?.role === "tool";
}

function contentLen(m) {
  if (!m) return 0;
  if (typeof m.content === "string") return m.content.length;
  if (Array.isArray(m.content)) {
    return m.content.reduce(
      (s, p) => s + (typeof p?.text === "string" ? p.text.length : 0),
      0
    );
  }
  return 0;
}

function compactToolMessage(m, maxChars) {
  if (!isTool(m) || typeof m.content !== "string") return m;
  if (m.content.length <= maxChars) return m;
  const head = Math.floor(maxChars * 0.7);
  const tail = Math.max(0, maxChars - head - 40);
  const next = {
    ...m,
    content:
      m.content.slice(0, head) +
      `\n…[evicted ${m.content.length - head - tail} chars]…\n` +
      (tail ? m.content.slice(-tail) : ""),
  };
  return next;
}

/**
 * Apply eviction policy. Never removes messages[0] if it is system.
 * Returns { messages, report }.
 */
export function evictMessages(messages, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  if (!cfg.enabled || cfg.policy === "none" || !messages?.length) {
    return {
      messages,
      report: { policy: cfg.policy || "none", evicted: 0, compacted: 0 },
    };
  }

  const policy = cfg.policy;
  let msgs = messages.map((m) => ({ ...m }));
  let evicted = 0;
  let compacted = 0;

  const system = isSystem(msgs[0]) ? msgs[0] : null;
  let rest = system ? msgs.slice(1) : msgs.slice();

  const protect = Math.max(0, cfg.protectRecent | 0);

  function protectSplit(list) {
    if (list.length <= protect) return { head: [], tail: list };
    return {
      head: list.slice(0, list.length - protect),
      tail: list.slice(list.length - protect),
    };
  }

  // --- sliding: drop oldest non-protected ---
  if (policy === "sliding" || policy === "hybrid") {
    const maxRest = Math.max(1, (cfg.maxMessages || 40) - (system ? 1 : 0));
    while (rest.length > maxRest) {
      const { head, tail } = protectSplit(rest);
      if (!head.length) break;
      head.shift();
      evicted++;
      rest = head.concat(tail);
    }
  }

  // --- tool_first: compact/drop oldest tool messages in unprotected region ---
  if (policy === "tool_first" || policy === "hybrid") {
    const { head, tail } = protectSplit(rest);
    const newHead = [];
    for (const m of head) {
      if (isTool(m) && cfg.compactTools) {
        const before = contentLen(m);
        const c = compactToolMessage(m, cfg.maxToolResultChars);
        if (contentLen(c) < before) compacted++;
        // If still huge relative to budget, drop content harder
        if (contentLen(c) > cfg.maxToolResultChars * 2) {
          evicted++;
          newHead.push({
            ...c,
            content: "[tool result evicted to save context]",
          });
        } else {
          newHead.push(c);
        }
      } else if (isTool(m) && !cfg.compactTools) {
        evicted++;
        newHead.push({
          ...m,
          content: "[tool result evicted to save context]",
        });
      } else {
        newHead.push(m);
      }
    }
    rest = newHead.concat(tail);
  }

  // --- token_budget: estimate and drop/compact from oldest ---
  if (policy === "token_budget" || policy === "hybrid") {
    const budget = cfg.maxHistoryTokens || 12000;
    const measure = (list) => {
      try {
        return countChatTokens(list, { mode: "heuristic", charsPerToken: 4 }).tokens;
      } catch {
        return list.reduce((s, m) => s + Math.ceil(contentLen(m) / 4), 0);
      }
    };

    // Iteratively compact oldest tools then drop oldest pairs
    let safety = 0;
    while (safety++ < 100) {
      const full = system ? [system, ...rest] : rest;
      const tokens = measure(full);
      if (tokens <= budget) break;

      const { head, tail } = protectSplit(rest);
      if (!head.length) break;

      // Prefer compacting oldest tool
      const toolIdx = head.findIndex(isTool);
      if (toolIdx >= 0 && cfg.compactTools) {
        const before = contentLen(head[toolIdx]);
        head[toolIdx] = compactToolMessage(
          head[toolIdx],
          Math.max(200, Math.floor(cfg.maxToolResultChars / 2))
        );
        if (contentLen(head[toolIdx]) < before) {
          compacted++;
          rest = head.concat(tail);
          continue;
        }
      }

      // Drop oldest message (and orphaned tool if needed)
      const removed = head.shift();
      evicted++;
      // If we removed an assistant with tool_calls, also drop following tools until non-tool
      while (head.length && isTool(head[0])) {
        head.shift();
        evicted++;
      }
      // If removed a tool, that's fine
      void removed;
      rest = head.concat(tail);
    }
  }

  const out = system ? [system, ...rest] : rest;
  return {
    messages: out,
    report: {
      policy,
      evicted,
      compacted,
      before: messages.length,
      after: out.length,
      protectedSystem: Boolean(system),
      protectRecent: protect,
    },
  };
}

/**
 * Run eviction just before a model call.
 */
export function applyEvictionBeforeChat(messages, cfg) {
  const opts = evictionConfigFromCfg(cfg);
  return evictMessages(messages, opts);
}
