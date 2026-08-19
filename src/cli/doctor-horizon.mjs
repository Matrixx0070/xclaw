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
    hasG15: horizon.some((c) => String(c.id).includes("G15")),
    hasG16: horizon.some((c) => String(c.id).includes("G16")),
    hasG17: horizon.some((c) => String(c.id).includes("G17")),
    hasG18: horizon.some((c) => String(c.id).includes("G18")),
    hasG19: horizon.some((c) => String(c.id).includes("G19")),
    hasG20: horizon.some((c) => String(c.id).includes("G20")),
    packComplete:
      horizon.filter((c) => /G(1[0-9]|20)/.test(String(c.id))).length >= 11,
    passTotal: getHorizonPassTotal(),
    metrics: renderHorizonMetrics(),
    at: new Date().toISOString(),
  };
}

export default { doctorHorizon };
