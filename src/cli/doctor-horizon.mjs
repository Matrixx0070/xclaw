/**
 * Doctor: horizon case count / pack completeness / soak policy / checkpoints.
 */
import { loadCases } from "../eval/runner.mjs";
import {
  getHorizonPassTotal,
  renderHorizonMetrics,
} from "../eval/horizon-metrics.mjs";
import { renderHorizonPackMetrics } from "../eval/horizon-pack-metrics.mjs";
import { loadSoakPolicy } from "../eval/horizon-soak-policy.mjs";
import { renderSoakMetrics } from "../eval/horizon-soak-metrics.mjs";
import { listSoakJobs } from "../eval/horizon-soak-checkpoint.mjs";
import { renderSoakResumeMetrics } from "../eval/horizon-soak-resume-metrics.mjs";

const EXPECTED = [
  "G10",
  "G11",
  "G12",
  "G13",
  "G14",
  "G15",
  "G16",
  "G17",
  "G18",
  "G19",
  "G20",
];

export async function doctorHorizon(cfg = {}) {
  const horizon = await loadCases({ tag: "horizon" });
  const ids = horizon.map((c) => c.id);
  const missing = EXPECTED.filter(
    (g) => !ids.some((id) => String(id).includes(g))
  );
  const packComplete = missing.length === 0;
  const soakJobs = await listSoakJobs({});
  return {
    ok: horizon.length >= 5,
    horizonCaseCount: horizon.length,
    ids,
    hasG15: ids.some((id) => String(id).includes("G15")),
    hasG16: ids.some((id) => String(id).includes("G16")),
    hasG17: ids.some((id) => String(id).includes("G17")),
    hasG18: ids.some((id) => String(id).includes("G18")),
    hasG19: ids.some((id) => String(id).includes("G19")),
    hasG20: ids.some((id) => String(id).includes("G20")),
    packComplete,
    missing,
    passTotal: getHorizonPassTotal(),
    metrics: renderHorizonMetrics(),
    metricsPack: renderHorizonPackMetrics(),
    soakPolicy: loadSoakPolicy({}),
    metricsSoak: renderSoakMetrics(),
    metricsResume: renderSoakResumeMetrics(),
    soakJobs,
    soakJobCount: soakJobs.length,
    lastCheckpointAt: soakJobs[0]?.updatedAt || null,
    at: new Date().toISOString(),
  };
}

export default { doctorHorizon };
