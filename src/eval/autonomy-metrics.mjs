/**
 * A4 — Autonomy metrics over agent/job trajectories.
 */
import { looksLikeHandoff, countToolsUsed } from "../agent/autonomy-policy.mjs";

/**
 * @param {{ text?: string, toolTrace?: object[], goalReceipt?: object, pass?: boolean }} run
 * @param {{ pass?: boolean }} [scored]
 */
export function scoreAutonomyRun(run = {}, scored = {}) {
  const text = String(run.text || "");
  const toolTrace = run.toolTrace || run.goalReceipt?.toolsUsed || [];
  const toolCount =
    typeof run.goalReceipt?.toolCallCount === "number"
      ? run.goalReceipt.toolCallCount
      : Array.isArray(toolTrace)
        ? countToolsUsed(toolTrace)
        : 0;
  const handoff = looksLikeHandoff(text);
  const toolFirst = toolCount > 0 || !handoff;
  const zeroToolHandoff = handoff && toolCount === 0;
  const completion = scored.pass === true || run.pass === true;

  return {
    completion,
    handoff,
    toolFirst: Boolean(toolFirst && !zeroToolHandoff),
    zeroToolHandoff,
    toolCount,
    alternateStrategyUsed: Boolean(run.goalReceipt?.alternateStrategyUsed),
    handoffRetryUsed: Boolean(run.goalReceipt?.handoffRetryUsed),
    stopReason: run.stopReason || run.goalReceipt?.stopReason || null,
  };
}

/**
 * @param {object[]} rows — per-case autonomy scores
 */
export function aggregateAutonomy(rows = []) {
  const n = rows.length || 0;
  const sum = (fn) => rows.reduce((a, r) => a + (fn(r) ? 1 : 0), 0);
  return {
    n,
    completion: n ? sum((r) => r.completion) / n : 0,
    handoffRate: n ? sum((r) => r.handoff) / n : 0,
    toolFirstRate: n ? sum((r) => r.toolFirst) / n : 0,
    zeroToolHandoffRate: n ? sum((r) => r.zeroToolHandoff) / n : 0,
    meanToolCount: n
      ? rows.reduce((a, r) => a + (r.toolCount || 0), 0) / n
      : 0,
  };
}

export default { scoreAutonomyRun, aggregateAutonomy };
