/**
 * Normalize / validate xAI (and shared) reasoning_effort values + xhigh coercion.
 *
 * xAI (docs):
 *   grok-4.5  → low | medium | high  (default high; cannot disable)
 *               xhigh is NOT supported → coerce to high
 *   grok-4.6  → low | medium | high | xhigh
 *   multi-agent → effort maps to agent count; xhigh allowed
 *   non-reasoning SKUs → effort is meaningless (omit)
 *
 * XClaw config:
 *   agent.reasoning: {
 *     enabled?: boolean,
 *     effort?: string,
 *     maxTokens?: number,
 *     coerceXhigh?: boolean,        // default true — map unsupported xhigh → high
 *     coerceXhighFor45?: boolean,   // alias of coerceXhigh (compat)
 *   }
 */
export const REASONING_EFFORTS = Object.freeze(["low", "medium", "high", "xhigh"]);

const ALIASES = Object.freeze({
  lo: "low",
  low: "low",
  med: "medium",
  medium: "medium",
  mid: "medium",
  hi: "high",
  high: "high",
  xhi: "xhigh",
  xhigh: "xhigh",
  "x-high": "xhigh",
  max: "xhigh",
  maximum: "xhigh",
});

/**
 * Classify model support for reasoning_effort / xhigh.
 * @param {string} model
 * @returns {{ supportsEffort: boolean, supportsXhigh: boolean, family: string }}
 */
export function modelReasoningCapabilities(model = "") {
  const m = String(model || "").toLowerCase();

  // Explicit non-reasoning SKUs — do not send reasoning_effort
  if (
    m.includes("non-reasoning") ||
    m.includes("non_reasoning") ||
    /grok-4\.20-0309-non-reasoning/.test(m)
  ) {
    return { supportsEffort: false, supportsXhigh: false, family: "non-reasoning" };
  }

  // Multi-agent: effort selects agent count; xhigh is valid
  if (m.includes("multi-agent") || m.includes("multi_agent")) {
    return { supportsEffort: true, supportsXhigh: true, family: "multi-agent" };
  }

  // grok-4.6 (+ future) — native xhigh
  if (/\bgrok-4\.6\b/.test(m) || m.includes("grok-4.6")) {
    return { supportsEffort: true, supportsXhigh: true, family: "grok-4.6" };
  }

  // grok-4.5 — effort yes, xhigh no (API treats as high; we coerce client-side)
  if (/\bgrok-4\.5\b/.test(m) || m.includes("grok-4.5")) {
    return { supportsEffort: true, supportsXhigh: false, family: "grok-4.5" };
  }

  // Pure reasoning dated SKUs — often ignore reasoning_effort
  if (m.includes("reasoning") && m.includes("4.20")) {
    return { supportsEffort: false, supportsXhigh: false, family: "grok-4.20-reasoning" };
  }

  // grok-4.3 / build / generic grok — effort sometimes accepted; xhigh not documented
  if (m.includes("grok-4.3") || m.includes("grok-build") || m.includes("grok-code")) {
    return { supportsEffort: true, supportsXhigh: false, family: "grok-4.3-or-build" };
  }

  if (m.includes("grok") || m.includes("xai")) {
    return { supportsEffort: true, supportsXhigh: false, family: "grok-other" };
  }

  // Unknown / non-xAI — pass through without coercion (provider may ignore)
  return { supportsEffort: true, supportsXhigh: true, family: "unknown" };
}

/**
 * @param {unknown} raw
 * @returns {string|null}
 */
export function parseEffortAlias(raw) {
  if (raw == null || raw === "") return null;
  const key = String(raw).trim().toLowerCase();
  return ALIASES[key] || (REASONING_EFFORTS.includes(key) ? key : null);
}

/**
 * Coerce effort to what the model actually supports.
 *
 * @param {string} effort  already-normalized (low|medium|high|xhigh)
 * @param {string} [model]
 * @param {object} [policy]
 * @param {boolean} [policy.coerceXhigh=true]
 * @returns {{ effort: string|null, coerced: boolean, reason: string|null, capabilities: object }}
 */
export function coerceReasoningEffort(effort, model = "", policy = {}) {
  const capabilities = modelReasoningCapabilities(model);
  if (!effort) {
    return { effort: null, coerced: false, reason: null, capabilities };
  }

  if (!capabilities.supportsEffort) {
    return {
      effort: null,
      coerced: true,
      reason: `omitted: model family ${capabilities.family} does not take reasoning_effort`,
      capabilities,
    };
  }

  const coerceXhigh = policy.coerceXhigh !== false;
  if (effort === "xhigh" && !capabilities.supportsXhigh && coerceXhigh) {
    return {
      effort: "high",
      coerced: true,
      reason: `xhigh→high: model family ${capabilities.family} has no xhigh`,
      capabilities,
    };
  }

  return { effort, coerced: false, reason: null, capabilities };
}

/**
 * @param {unknown} raw
 * @param {object} [opts]
 * @param {string} [opts.model]
 * @param {boolean} [opts.coerceXhigh]
 * @param {boolean} [opts.coerceXhighFor45] compat alias
 * @param {boolean} [opts.returnMeta=false] if true, return full coerce result
 * @returns {string|null|object}
 */
export function normalizeReasoningEffort(raw, opts = {}) {
  const parsed = parseEffortAlias(raw);
  if (!parsed) return opts.returnMeta ? coerceReasoningEffort(null, opts.model, opts) : null;

  const coerceXhigh =
    opts.coerceXhigh !== false && opts.coerceXhighFor45 !== false;

  const result = coerceReasoningEffort(parsed, opts.model, { coerceXhigh });
  return opts.returnMeta ? result : result.effort;
}

/**
 * Whether agent.reasoning should activate sampling overrides.
 */
export function isReasoningConfigured(reasoningCfg) {
  if (!reasoningCfg || typeof reasoningCfg !== "object") return false;
  if (reasoningCfg.enabled === true) return true;
  if (reasoningCfg.effort) return true;
  return false;
}

/**
 * Resolve effort from cfg + per-call override (with coercion).
 * @returns {string|null}
 */
export function resolveReasoningEffort({ cfg, model, callEffort } = {}) {
  const reasoningCfg = cfg?.agent?.reasoning || null;
  const raw =
    callEffort !== undefined && callEffort !== null
      ? callEffort
      : reasoningCfg?.effort;
  return normalizeReasoningEffort(raw, {
    model,
    coerceXhigh: reasoningCfg?.coerceXhigh,
    coerceXhighFor45: reasoningCfg?.coerceXhighFor45,
  });
}

/**
 * Full resolve with coercion metadata (for logs / onEvent).
 */
export function resolveReasoningEffortMeta({ cfg, model, callEffort } = {}) {
  const reasoningCfg = cfg?.agent?.reasoning || null;
  const raw =
    callEffort !== undefined && callEffort !== null
      ? callEffort
      : reasoningCfg?.effort;
  const parsed = parseEffortAlias(raw);
  return coerceReasoningEffort(parsed, model, {
    coerceXhigh:
      reasoningCfg?.coerceXhigh !== false &&
      reasoningCfg?.coerceXhighFor45 !== false,
  });
}

export default {
  REASONING_EFFORTS,
  modelReasoningCapabilities,
  parseEffortAlias,
  coerceReasoningEffort,
  normalizeReasoningEffort,
  isReasoningConfigured,
  resolveReasoningEffort,
  resolveReasoningEffortMeta,
};
