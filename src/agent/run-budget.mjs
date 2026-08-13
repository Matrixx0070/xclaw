/**
 * Per-run budget caps for unattended operation.
 *
 * cfg.agent.budget: { maxToolCalls, maxTokens, maxWallMs } — each optional,
 * active only when > 0. The loop checks at every turn boundary and stops the
 * run gracefully (post-run pipeline still runs) when any cap is hit.
 */

function cap(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * @param {object} cfg
 * @param {object} [opts]
 * @param {number} [opts.startedAt]
 */
export function createRunBudget(cfg = {}, { startedAt = Date.now() } = {}) {
  const b = cfg?.agent?.budget || {};
  const maxToolCalls = cap(b.maxToolCalls);
  const maxTokens = cap(b.maxTokens);
  const maxWallMs = cap(b.maxWallMs);
  const enabled = Boolean(maxToolCalls || maxTokens || maxWallMs);

  /**
   * @param {object} [state]
   * @param {number} [state.toolCalls] — tool calls dispatched so far
   * @param {number} [state.totalTokens] — accumulated real/estimated tokens
   * @param {number} [state.now]
   * @returns {{reason: string, limit: number, used: number} | null}
   */
  function check({ toolCalls = 0, totalTokens = 0, now = Date.now() } = {}) {
    if (!enabled) return null;
    if (maxWallMs != null && now - startedAt >= maxWallMs) {
      return { reason: "wall_clock_ms", limit: maxWallMs, used: now - startedAt };
    }
    if (maxToolCalls != null && toolCalls >= maxToolCalls) {
      return { reason: "tool_calls", limit: maxToolCalls, used: toolCalls };
    }
    if (maxTokens != null && totalTokens >= maxTokens) {
      return { reason: "tokens", limit: maxTokens, used: totalTokens };
    }
    return null;
  }

  return { enabled, maxToolCalls, maxTokens, maxWallMs, startedAt, check };
}

export default { createRunBudget };
