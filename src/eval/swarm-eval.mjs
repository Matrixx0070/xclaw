/**
 * Swarm eval scorer — completionRate + hardBlockRate ceiling.
 */
import { swarmReceiptSummary } from "../jobs/swarm-receipt.mjs";

export function scoreSwarm(swarm, opts = {}) {
  const minCompletion = opts.minCompletion ?? 0.8;
  const maxHardBlockRate = opts.maxHardBlockRate ?? 0.25;
  const sum = swarmReceiptSummary(swarm);
  if (!sum.ok) {
    return { ok: false, reason: sum.reason || "missing", ...sum };
  }
  const children = swarm.children || [];
  const passed = children.filter((c) => c.pass === true || c.status === "succeeded").length;
  const childCount = children.length || 0;
  const completionRate = childCount ? passed / childCount : 0;
  const hardBlockRate = childCount ? (sum.hardBlocks || 0) / childCount : 0;
  const ceilingExceeded = hardBlockRate > maxHardBlockRate;
  const completionOk = completionRate >= minCompletion;
  return {
    ok: completionOk && !ceilingExceeded && !sum.anyCircuit,
    completionRate,
    hardBlockRate,
    childCount,
    passed,
    anyCircuit: sum.anyCircuit,
    ceilingExceeded,
    completionOk,
    maxHardBlockRate,
    minCompletion,
  };
}

export default { scoreSwarm };
