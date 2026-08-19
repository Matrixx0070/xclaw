/**
 * Live horizon runner — API key optional; default runAgent from run-agent.mjs.
 */
import { runHorizonSuiteOffline } from "./horizon-offline.mjs";
import {
  incHorizonLiveRuns,
  incHorizonLiveFail,
  renderHorizonLiveMetrics,
} from "./horizon-live-metrics.mjs";
import {
  loadSoakPolicy,
  beforeSoakTurn,
  checkSoakCaps,
} from "./horizon-soak-policy.mjs";
import { incSoakBlock, renderSoakMetrics } from "./horizon-soak-metrics.mjs";

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
  const policy = loadSoakPolicy({
    maxUsd: opts.maxUsd,
    maxTurns: opts.maxTurns ?? opts.cfg?.agent?.maxTurns,
    usedUsd: opts.usedUsd,
    turns: opts.turns,
  });
  const maxTurns = policy.maxTurns;
  const timeoutMs = Number(opts.timeoutMs ?? 120_000);
  const pre = checkSoakCaps(policy, {
    usedUsd: policy.usedUsd,
    turns: policy.turns,
  });
  if (!pre.ok) {
    incSoakBlock();
    return {
      ok: false,
      mode: "soak_blocked",
      code: pre.code,
      reason: pre.reason,
      policy: pre.policy,
      metricsLive: renderHorizonLiveMetrics(),
      metricsSoak: renderSoakMetrics(),
    };
  }

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
        const turnGuard = beforeSoakTurn(policy, {
          turns: policy.turns,
          usedUsd: policy.usedUsd,
        });
        if (!turnGuard.ok) {
          incSoakBlock();
          return {
            ok: false,
            mode: "soak_blocked",
            code: turnGuard.code,
            reason: turnGuard.reason,
            policy: turnGuard.policy,
            metricsLive: renderHorizonLiveMetrics(),
            metricsSoak: renderSoakMetrics(),
          };
        }
        const live = await runAgent({
          ...opts,
          maxTurns,
          maxUsd: policy.maxUsd,
          signal: controller.signal,
        });
        return {
          ok: live?.ok !== false,
          mode: "live",
          maxTurns,
          timeoutMs,
          policy,
          live,
          metricsLive: renderHorizonLiveMetrics(),
          metricsSoak: renderSoakMetrics(),
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
