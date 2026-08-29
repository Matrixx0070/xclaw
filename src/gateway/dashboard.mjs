/**
 * Single snapshot for Control UI / ops.
 */
import { computerBaseUrl, isComputerRunning } from "../computer/manager.mjs";
import { queueStats } from "../jobs/queue.mjs";
import { listJobs } from "../jobs/history.mjs";
import { listEvalHistory } from "../eval/history.mjs";
import { summarizeEvalSpend } from "../eval/spend.mjs";
import { evalCronStatus } from "../cron/eval-job.mjs";
import { listProfiles } from "../config/profiles.mjs";
import { uptimeInfo } from "./uptime.mjs";
// Was a local pkgVersion() that re-read package.json on every dashboard build,
// so the Control UI showed the checkout's version, not the running gateway's.
import { runningVersion as pkgVersion } from "./build-version.mjs";

export async function buildDashboard(cfg) {
  let computerUp = false;
  let watchdog = { active: false };
  try {
    computerUp = await isComputerRunning(cfg);
  } catch {
    /* */
  }
  try {
    const { watchdogStatus } = await import("../computer/watchdog.mjs");
    watchdog = watchdogStatus();
  } catch {
    /* */
  }
  let qstats = null;
  try {
    qstats = await queueStats(cfg);
  } catch (e) {
    qstats = { error: e.message };
  }
  let recentJobs = [];
  try {
    recentJobs = await listJobs(cfg, { limit: 5 });
  } catch {
    /* */
  }
  let evalHist = [];
  let spend = null;
  try {
    evalHist = await listEvalHistory(cfg, { limit: 5 });
    spend = await summarizeEvalSpend(cfg, { limit: 50 });
  } catch {
    /* */
  }
  let cron = null;
  try {
    cron = evalCronStatus(cfg);
  } catch {
    /* */
  }
  const out = {
    at: new Date().toISOString(),
    version: pkgVersion(),
    uptime: uptimeInfo(),
    profile: cfg.profile || "dev",
    profiles: listProfiles(),
    computer: { up: computerUp, url: computerBaseUrl(cfg), watchdog },
    gateway: { host: cfg.gateway?.host, port: cfg.gateway?.port },
    queue: qstats,
    recentJobs,
    eval: {
      history: evalHist,
      spend,
      cron,
    },
    agent: {
      model: cfg.agent?.model,
      provider: cfg.agent?.provider,
      maxTurns: cfg.agent?.maxTurns,
      autoApprove: cfg.security?.autoApprove,
    },
    usage: null,
    costGovernor: null,
  };
  try {
    const { buildUsageDashboard } = await import("../tokens/usage-analytics.mjs");
    const ud = await buildUsageDashboard(cfg, { days: 7 });
    out.usage = {
      days: ud.usage?.days,
      totals: ud.usage?.totals,
      daily: ud.usage?.daily,
      byProvider: ud.usage?.byProvider,
      byModel: (ud.usage?.byModel || []).slice(0, 8),
    };
    out.costGovernor = ud.governor;
  } catch {
    /* optional — ledger may be empty */
  }
  return out;
}
