/**
 * Doctor: last canary fails + cost blocks.
 */
import {
  getCanaryUngroundedTotal,
  renderCanaryMetrics,
} from "../agent/canary-metrics.mjs";
import { doctorAutonomySummary } from "./doctor-autonomy.mjs";

export async function doctorCanaryCost(cfg = {}, job = {}) {
  const auto = await doctorAutonomySummary(cfg, job);
  const costBlocks =
    job?.receipt?.costBlocks ||
    job?.evidence?.filter((e) => e?.type === "cost_governor") ||
    [];
  return {
    ok: auto.ok,
    canaryUngroundedTotal: getCanaryUngroundedTotal(),
    costBlocks: costBlocks.length,
    lastCost: costBlocks[costBlocks.length - 1] || null,
    metrics: renderCanaryMetrics(),
    autonomy: auto,
    at: new Date().toISOString(),
  };
}

export default { doctorCanaryCost };
