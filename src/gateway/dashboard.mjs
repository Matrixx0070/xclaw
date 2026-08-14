/**
 * Single snapshot for Control UI / ops.
 */
import { isComputerRunning } from "../computer/manager.mjs";
import { queueStats } from "../jobs/queue.mjs";
import { listJobs } from "../jobs/history.mjs";
import { listEvalHistory } from "../eval/history.mjs";
import { summarizeEvalSpend } from "../eval/spend.mjs";
import { evalCronStatus } from "../cron/eval-job.mjs";
import { listProfiles } from "../config/profiles.mjs";
import { uptimeInfo } from "./uptime.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function pkgVersion() {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

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
    cron = evalCronStatus();
  } catch {
    /* */
  }
  const out = {
    at: new Date().toISOString(),
    version: pkgVersion(),
    uptime: uptimeInfo(),
    profile: cfg.profile || "dev",
    profiles: listProfiles(),
    computer: { up: computerUp, url: `http://${cfg.computer?.host}:${cfg.computer?.port}`, watchdog },
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
