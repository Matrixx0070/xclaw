/**
 * Doctor autonomy surface: loop, cost, evidence, canary.
 */
import { createLoopGuard } from "../agent/loop-guards.mjs";
import { createCostGovernor } from "../agent/cost-governor.mjs";
import { snapshotTokenCache } from "../agent/token-cache-metrics.mjs";
import { runHallucinationCanary } from "../agent/hallucination-canary.mjs";
import { runAutonomyOfflineGate } from "../eval/autonomy-offline-gate.mjs";

export async function doctorAutonomySummary(cfg = {}, job = {}) {
  const guard = createLoopGuard(cfg.agent?.loopGuard || {});
  const cost = createCostGovernor(cfg, job);
  const costCheck = cost.check({
    toolCalls: job.toolCalls || 0,
    totalTokens: job.totalTokens || 0,
  });
  const canary = runHallucinationCanary({
    text: job.text || job.lastAssistant || "",
    toolTrace: job.toolTrace || [],
  });
  const gate = await runAutonomyOfflineGate({
    hardBlockRate: job.hardBlockRate || 0,
  });
  const singleGateway =
    cfg?.cluster?.enabled !== true && cfg?.gateway?.clusterRole !== "coordinator";

  return {
    ok: gate.ok && canary.ok && !costCheck.blocked,
    loop: guard.snapshot?.() || { ready: true },
    cost: costCheck,
    tokens: snapshotTokenCache(),
    canary,
    gate,
    singleGateway,
    at: new Date().toISOString(),
  };
}

export default { doctorAutonomySummary };
