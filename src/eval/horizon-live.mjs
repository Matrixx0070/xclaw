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
import {
  loadSoakCheckpoint,
  saveSoakCheckpoint,
} from "./horizon-soak-checkpoint.mjs";
import {
  incSoakResume,
  renderSoakResumeMetrics,
} from "./horizon-soak-resume-metrics.mjs";
import { resolveLiveGoals } from "./horizon-live-goals.mjs";
import {
  writeLiveSoakReport,
  DEFAULT_LIVE_IDS,
} from "./horizon-live-report.mjs";

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
  const soakJobId = opts.soakJobId || opts.jobId || null;
  let checkpoint = null;
  if (soakJobId) {
    checkpoint = await loadSoakCheckpoint(soakJobId, { base: opts.soakBase });
    if (checkpoint.turns > 0 || checkpoint.usedUsd > 0) {
      incSoakResume();
    }
  }
  const policy = loadSoakPolicy({
    maxUsd: opts.maxUsd,
    maxTurns: opts.maxTurns ?? opts.cfg?.agent?.maxTurns,
    usedUsd: opts.usedUsd ?? checkpoint?.usedUsd,
    turns: opts.turns ?? checkpoint?.turns,
  });
  const maxTurns = policy.maxTurns;
  const timeoutMs = Number(opts.timeoutMs ?? 120_000);
  const pre = checkSoakCaps(policy, {
    usedUsd: policy.usedUsd,
    turns: policy.turns,
  });
  if (!pre.ok) {
    incSoakBlock();
    if (soakJobId) {
      await saveSoakCheckpoint(
        soakJobId,
        {
          turns: pre.policy.turns,
          usedUsd: pre.policy.usedUsd,
          workspace: opts.workspace || null,
        },
        { base: opts.soakBase }
      );
    }
    return {
      ok: false,
      mode: "soak_blocked",
      code: pre.code,
      reason: pre.reason,
      policy: pre.policy,
      soakJobId,
      metricsLive: renderHorizonLiveMetrics(),
      metricsSoak: renderSoakMetrics(),
      metricsResume: renderSoakResumeMetrics(),
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
        const resolved = await resolveLiveGoals({
          ids: opts.ids || DEFAULT_LIVE_IDS,
          goals: opts.goals,
        });
        const missing = resolved.goals.filter((g) => !g.prompt);
        if (missing.length === resolved.goals.length) {
          return {
            ok: false,
            mode: "live",
            code: "empty_goal",
            error: "empty_goal",
            ids: resolved.ids,
            policy,
            soakJobId,
          };
        }
        const results = [];
        let live = null;
        for (const g of resolved.goals) {
          if (!g.prompt) {
            results.push({ id: g.id, ok: false, error: "empty_goal" });
            continue;
          }
          live = await runAgent({
            ...opts,
            goal: g.prompt,
            userMessage: g.prompt,
            workingDir: opts.workspace || opts.workingDir || process.cwd(),
            maxTurns: g.maxTurns || maxTurns,
            maxUsd: policy.maxUsd,
            signal: controller.signal,
            channel: opts.channel || "eval",
          });
          results.push({
            id: g.id,
            ok: live?.ok !== false && live?.error !== "empty_goal",
            error: live?.error || null,
          });
          if (live?.error === "empty_goal") {
            break;
          }
        }
        const allOk = results.length > 0 && results.every((r) => r.ok);
        if (soakJobId) {
          await saveSoakCheckpoint(
            soakJobId,
            {
              turns: (policy.turns || 0) + results.length,
              usedUsd: policy.usedUsd,
              workspace: opts.workspace || null,
              receipts: results.map((r) => ({
                at: new Date().toISOString(),
                id: r.id,
                ok: r.ok,
              })),
            },
            { base: opts.soakBase }
          );
        }
        const written = await writeLiveSoakReport(
          {
            mode: "live",
            ok: allOk,
            ids: resolved.ids,
            usedUsd: policy.usedUsd,
            turns: (policy.turns || 0) + results.length,
            soakJobId,
            canary: { fail: 0 },
          },
          { base: opts.soakBase }
        );
        return {
          ok: allOk,
          mode: "live",
          maxTurns,
          timeoutMs,
          policy,
          soakJobId,
          ids: resolved.ids,
          results,
          live,
          liveReportPath: written.path,
          liveReport: written.report,
          metricsLive: renderHorizonLiveMetrics(),
          metricsSoak: renderSoakMetrics(),
          metricsResume: renderSoakResumeMetrics(),
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
