import { doctorHorizon } from "./doctor-horizon.mjs";
import {
  getHorizonLiveRunsTotal,
  renderHorizonLiveMetrics,
} from "../eval/horizon-live-metrics.mjs";
import { renderHorizonMetrics } from "../eval/horizon-metrics.mjs";

let lastMode = null;

export function noteHorizonMode(mode) {
  lastMode = mode;
  return lastMode;
}

export async function doctorHorizonMode(cfg = {}) {
  const base = await doctorHorizon(cfg);
  return {
    ...base,
    lastMode,
    liveRuns: getHorizonLiveRunsTotal(),
    metrics: renderHorizonMetrics() + renderHorizonLiveMetrics(),
  };
}

export default { doctorHorizonMode, noteHorizonMode };
