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
import { beforeLiveTurn, afterLiveTurn, renderLiveTurnMetrics, noteLastLiveRun } from "./horizon-live-turn.mjs";
import {
  acquireSoakLeaseSelected,
  releaseSoakLeaseSelected,
} from "./horizon-soak-lease-select.mjs";
import {
  incSoakLeaseDenied,
  renderSoakLeaseMetrics,
} from "./horizon-soak-lease-metrics.mjs";
import { resolveLiveGoals } from "./horizon-live-goals.mjs";
import { accumulateSpend, budgetForTurn } from "./live-spend.mjs";
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
  let lease = null;
  if (soakJobId) {
    checkpoint = await loadSoakCheckpoint(soakJobId, { base: opts.soakBase });
    if (checkpoint.turns > 0 || checkpoint.usedUsd > 0) {
      incSoakResume();
    }
    lease = await acquireSoakLeaseSelected(soakJobId, {
      base: opts.soakBase,
      owner: opts.leaseOwner,
      redis: opts.redis,
      backend: opts.leaseBackend,
      ttlMs: opts.leaseTtlMs,
    });
    if (!lease.ok) {
      incSoakLeaseDenied();
      return {
        ok: false,
        mode: "lease_denied",
        code: lease.code,
        lease,
        soakJobId,
        metricsLive: renderHorizonLiveMetrics(),
        metricsLease: renderSoakLeaseMetrics(),
      };
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
        // Spend carried across goals. The cap used to be checked once, before
        // the loop, against a counter nobody incremented — so N goals each ran
        // against an untouched $0 and the ceiling could not fire.
        let spend = { usedUsd: policy.usedUsd || 0, unpricedTurns: 0 };
        let capBlock = null;
        for (const g of resolved.goals) {
          if (!g.prompt) {
            results.push({ id: g.id, ok: false, error: "empty_goal" });
            continue;
          }
          const cap = checkSoakCaps(policy, {
            usedUsd: spend.usedUsd,
            turns: (policy.turns || 0) + results.length,
          });
          if (!cap.ok) {
            capBlock = cap;
            break;
          }
          // normalizeAgentRequest passes a fixed 16-key allow-list, and
          // neither maxUsd nor maxTurns is on it — both were dropped in
          // transit, so the soak's per-goal budget reached nothing and
          // XCLAW_SOAK_MAX_TURNS silently ran at the agent default. cfg IS on
          // the list, and it is where loop.mjs and the run governor read them.
          //
          // Computed BEFORE the turn is announced: a zero budget is the soak
          // saying it has nothing left to spend, and the only correct response
          // is to not start the goal. checkSoakCaps above blocks on strict `>`,
          // so spending the budget to the exact penny walks straight past it.
          const turnBudget = budgetForTurn(
            opts.cfg?.agent?.budget?.maxUsd,
            policy.maxUsd - spend.usedUsd
          );
          if (turnBudget === 0) {
            capBlock = {
              ok: false,
              code: "SOAK_USD_EXCEEDED",
              reason: `soak budget exhausted (${spend.usedUsd} of ${policy.maxUsd})`,
              policy: {
                ...policy,
                usedUsd: spend.usedUsd,
                turns: (policy.turns || 0) + results.length,
              },
            };
            break;
          }
          await beforeLiveTurn();
          live = await runAgent({
            ...opts,
            cfg: {
              ...(opts.cfg || {}),
              agent: {
                ...(opts.cfg?.agent || {}),
                maxTurns: g.maxTurns || maxTurns,
                budget: {
                  ...(opts.cfg?.agent?.budget || {}),
                  ...(turnBudget == null ? {} : { maxUsd: turnBudget }),
                },
              },
            },
            goal: g.prompt,
            userMessage: g.prompt,
            workingDir: opts.workspace || opts.workingDir || process.cwd(),
            signal: controller.signal,
            channel: opts.channel || "eval",
          });
          spend = accumulateSpend(spend, live);
          results.push({
            id: g.id,
            ok: live?.ok !== false && live?.error !== "empty_goal",
            error: live?.error || null,
          });
          // Fed the accumulator, not `...opts`. Spreading opts handed the
          // checkpoint the values this run STARTED from, so the per-goal save
          // re-wrote the opening balance N times and never advanced: a soak
          // killed after goal 4 resumed as though it had spent nothing.
          await afterLiveTurn({
            workspace: opts.workspace || null,
            mode: opts.mode,
            soakBase: opts.soakBase,
            goalId: g.id,
            result: live,
            soakJobId,
            turns: (policy.turns || 0) + results.length,
            usedUsd: spend.usedUsd,
            receipts: results.map((r) => ({
              at: new Date().toISOString(),
              id: r.id,
              ok: r.ok,
            })),
          });
          if (live?.error === "empty_goal") {
            break;
          }
        }
        const allOk =
          !capBlock && results.length > 0 && results.every((r) => r.ok);
        if (soakJobId) {
          await saveSoakCheckpoint(
            soakJobId,
            {
              turns: (policy.turns || 0) + results.length,
              usedUsd: spend.usedUsd,
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
            usedUsd: spend.usedUsd,
            unpricedTurns: spend.unpricedTurns,
            turns: (policy.turns || 0) + results.length,
            soakJobId,
            canary: { fail: 0 },
          },
          { base: opts.soakBase }
        );
        if (capBlock) incSoakBlock();
        return {
          ok: allOk,
          mode: capBlock ? "soak_blocked" : "live",
          ...(capBlock ? { code: capBlock.code, reason: capBlock.reason } : {}),
          maxTurns,
          timeoutMs,
          policy: capBlock ? capBlock.policy : { ...policy, usedUsd: spend.usedUsd },
          usedUsd: spend.usedUsd,
          unpricedTurns: spend.unpricedTurns,
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
