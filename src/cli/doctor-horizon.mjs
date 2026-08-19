/**
 * Doctor: horizon case count / last soak.
 */
import { loadCases } from "../eval/runner.mjs";
import {
  getHorizonPassTotal,
  renderHorizonMetrics,
} from "../eval/horizon-metrics.mjs";

export async function doctorHorizon(cfg = {}) {
  const horizon = await loadCases({ tag: "horizon" });
  return {
    ok: horizon.length >= 5,
    horizonCaseCount: horizon.length,
    ids: horizon.map((c) => c.id),
    passTotal: getHorizonPassTotal(),
    metrics: renderHorizonMetrics(),
    at: new Date().toISOString(),
  };
}

export default { doctorHorizon };
