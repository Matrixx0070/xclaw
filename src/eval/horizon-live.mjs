/**
 * Live horizon runner — API key optional; default runAgent from run-agent.mjs.
 */
import { runHorizonSuiteOffline } from "./horizon-offline.mjs";
import {
  incHorizonLiveRuns,
  incHorizonLiveFail,
  renderHorizonLiveMetrics,
} from "./horizon-live-metrics.mjs";

export function hasLiveKey(cfg = {}) {
  return Boolean(
    process.env.XCLAW_API_KEY ||
      process.env.XAI_API_KEY ||
      process.env.GROK_API_KEY ||
      process.env.OPENAI_API_KEY ||
      cfg?.provider?.apiKey ||
      cfg?.agent?.apiKey
  );
}

export async function runHorizonLive(opts = {}) {
  const requireLive = opts.requireLive === true || opts["require-live"] === true;
  const key = hasLiveKey(opts.cfg);
  const maxTurns = Number(opts.maxTurns ?? opts.cfg?.agent?.maxTurns ?? 8);
  const timeoutMs = Number(opts.timeoutMs ?? 120_000);

  if (!key) {
    if (requireLive) {
      return { ok: false, code: "LIVE_KEY_REQUIRED", offlineFallback: false };
    }
    return {
      ok: true,
      mode: "offline_fallback",
      ...(await runHorizonSuiteOffline(opts)),
      metricsLive: renderHorizonLiveMetrics(),
    };
  }

  incHorizonLiveRuns();
  try {
    let runAgent = opts.runAgent;
    if (!runAgent) {
      try {
        const mod = await import("../agent/run-agent.mjs");
        runAgent = mod.runAgent || mod.default?.runAgent;
      } catch {
        /* optional */
      }
    }
    if (runAgent && typeof runAgent === "function") {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const live = await runAgent({
          ...opts,
          maxTurns,
          signal: controller.signal,
        });
        return {
          ok: live?.ok !== false,
          mode: "live",
          maxTurns,
          timeoutMs,
          live,
          metricsLive: renderHorizonLiveMetrics(),
        };
      } finally {
        clearTimeout(timer);
      }
    }
    const offline = await runHorizonSuiteOffline(opts);
    return {
      ok: offline.ok,
      mode: "live_pending",
      note: "runAgent unavailable; offline suite used",
      hasKey: true,
      maxTurns,
      timeoutMs,
      ...offline,
      metricsLive: renderHorizonLiveMetrics(),
    };
  } catch (e) {
    incHorizonLiveFail();
    return {
      ok: false,
      mode: "live_error",
      error: String(e.message || e),
      metricsLive: renderHorizonLiveMetrics(),
    };
  }
}

export default { runHorizonLive, hasLiveKey };
