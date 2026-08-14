/**
 * Normalize / validate xAI (and shared) reasoning_effort values.
 *
 * xAI (docs):
 *   grok-4.5  → low | medium | high  (default high; cannot disable)
 *   grok-4.6  → low | medium | high | xhigh
 *   multi-agent → effort maps to agent count (still accept xhigh)
 *   On models that lack xhigh, the API typically coerces xhigh → high.
 *
 * XClaw config:
 *   agent.reasoning: { enabled?: boolean, effort?: string, maxTokens?: number }
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
 * @param {unknown} raw
 * @param {object} [opts]
 * @param {string} [opts.model] model id for soft mapping
 * @param {boolean} [opts.coerceXhighFor45=true] map xhigh→high for grok-4.5*
 * @returns {string|null} normalized effort or null if unset/invalid
 */
export function normalizeReasoningEffort(raw, opts = {}) {
  if (raw == null || raw === "") return null;
  const key = String(raw).trim().toLowerCase();
  const effort = ALIASES[key] || (REASONING_EFFORTS.includes(key) ? key : null);
  if (!effort) return null;

  const model = String(opts.model || "").toLowerCase();
  const coerce = opts.coerceXhighFor45 !== false;
  // 4.5 does not document xhigh; API may accept and treat as high — optional explicit coerce
  if (
    coerce &&
    effort === "xhigh" &&
    (model.includes("grok-4.5") || model === "grok-4.5")
  ) {
    return "high";
  }
  return effort;
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
 * Resolve effort from cfg + per-call override.
 */
export function resolveReasoningEffort({ cfg, model, callEffort } = {}) {
  const reasoningCfg = cfg?.agent?.reasoning || null;
  const raw =
    callEffort !== undefined && callEffort !== null
      ? callEffort
      : reasoningCfg?.effort;
  return normalizeReasoningEffort(raw, {
    model,
    coerceXhighFor45: cfg?.agent?.reasoning?.coerceXhighFor45 !== false,
  });
}

export default {
  REASONING_EFFORTS,
  normalizeReasoningEffort,
  isReasoningConfigured,
  resolveReasoningEffort,
};
