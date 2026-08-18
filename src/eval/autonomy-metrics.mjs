/**
 * A4 — Autonomy metrics over agent/job trajectories.
 */
import { looksLikeHandoff, countToolsUsed } from "../agent/autonomy-policy.mjs";

/**
 * @param {{ text?: string, toolTrace?: object[], goalReceipt?: object, pass?: boolean, quotaEscalate?: object, receiptMetrics?: object }} run
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
  const q = run.quotaEscalate || run.receiptMetrics?.quotaEscalate || {};
  const hardBlocks = Number(q.hardBlocks) || 0;
  const softWarns = Number(q.softWarns) || 0;

  return {
    completion,
    handoff,
    toolFirst: Boolean(toolFirst && !zeroToolHandoff),
    zeroToolHandoff,
    toolCount,
    alternateStrategyUsed: Boolean(run.goalReceipt?.alternateStrategyUsed),
    handoffRetryUsed: Boolean(run.goalReceipt?.handoffRetryUsed),
    stopReason: run.stopReason || run.goalReceipt?.stopReason || null,
    hardBlocks,
    softWarns,
    quotaHard: hardBlocks > 0,
  };
}

/**
 * @param {object[]} rows — per-case autonomy scores
 */
export function aggregateAutonomy(rows = []) {
  const n = rows.length || 0;
  const sum = (fn) => rows.reduce((a, r) => a + (fn(r) ? 1 : 0), 0);
  const hardBlocks = rows.reduce((a, r) => a + (Number(r.hardBlocks) || 0), 0);
  const softWarns = rows.reduce((a, r) => a + (Number(r.softWarns) || 0), 0);
  return {
    n,
    completion: n ? sum((r) => r.completion) / n : 0,
    handoffRate: n ? sum((r) => r.handoff) / n : 0,
    toolFirstRate: n ? sum((r) => r.toolFirst) / n : 0,
    zeroToolHandoffRate: n ? sum((r) => r.zeroToolHandoff) / n : 0,
    meanToolCount: n
      ? rows.reduce((a, r) => a + (r.toolCount || 0), 0) / n
      : 0,
    hardBlocks,
    softWarns,
    hardBlockRate: n ? hardBlocks / n : 0,
    quotaHardRate: n ? sum((r) => r.quotaHard) / n : 0,
  };
}

export function hardBlockRateCeilingVerdict(agg = {}, opts = {}) {
  const rate = Number(agg.hardBlockRate);
  const max = Number(
    opts.maxHardBlockRate ?? process.env.XCLAW_MAX_HARD_BLOCK_RATE ?? 0.25
  );
  const skipped = !Number.isFinite(rate);
  const exceeded = !skipped && rate > max;
  return {
    ok: !exceeded,
    exceeded,
    skipped,
    hardBlockRate: skipped ? null : rate,
    max,
    reason: exceeded ? "hard_block_rate_ceiling" : "ok",
  };
}

export function attachCeilingToAggregate(agg = {}, opts = {}) {
  const ceiling = hardBlockRateCeilingVerdict(agg, opts);
  return { ...agg, ceiling, ok: ceiling.ok };
}

export default { scoreAutonomyRun, aggregateAutonomy, hardBlockRateCeilingVerdict, attachCeilingToAggregate };
