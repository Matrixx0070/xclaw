/**
 * Cost governor — soft/hard daily and per-job USD caps.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { getModelMeta } from "../providers/registry.mjs";

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function ledgerPath(cfg) {
  const base = cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw");
  return path.join(base, "cost-governor.json");
}

async function loadLedger(cfg) {
  try {
    return JSON.parse(await fs.readFile(ledgerPath(cfg), "utf8"));
  } catch {
    return { day: dayKey(), spentUsd: 0, jobs: 0, paused: false, events: [] };
  }
}

async function saveLedger(cfg, ledger) {
  const fp = ledgerPath(cfg);
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, JSON.stringify(ledger, null, 2));
}

function limits(cfg) {
  const g = cfg?.cost || cfg?.tokens?.cost || {};
  return {
    dailySoftUsd: g.dailySoftUsd ?? 5,
    dailyHardUsd: g.dailyHardUsd ?? 15,
    perJobUsd: g.perJobUsd ?? 1,
    pauseQueueOnHard: g.pauseQueueOnHard !== false,
  };
}

/**
 * @returns {{ ok: boolean, soft?: boolean, hard?: boolean, spentUsd: number, limits: object, message?: string }}
 */
export async function checkCostBudget(cfg, { estimateUsd = 0 } = {}) {
  const lim = limits(cfg);
  let ledger = await loadLedger(cfg);
  if (ledger.day !== dayKey()) {
    ledger = { day: dayKey(), spentUsd: 0, jobs: 0, paused: false, events: [] };
    await saveLedger(cfg, ledger);
  }
  const projected = (ledger.spentUsd || 0) + (estimateUsd || 0);
  if (projected > lim.dailyHardUsd) {
    return {
      ok: false,
      hard: true,
      soft: true,
      spentUsd: ledger.spentUsd,
      limits: lim,
      paused: ledger.paused,
      message: `Hard daily cap $${lim.dailyHardUsd} exceeded (spent $${ledger.spentUsd.toFixed(4)})`,
    };
  }
  if (projected > lim.dailySoftUsd) {
    return {
      ok: true,
      soft: true,
      hard: false,
      spentUsd: ledger.spentUsd,
      limits: lim,
      paused: ledger.paused,
      message: `Soft daily cap $${lim.dailySoftUsd} exceeded — proceeding with warning`,
    };
  }
  return {
    ok: true,
    soft: false,
    hard: false,
    spentUsd: ledger.spentUsd,
    limits: lim,
    paused: ledger.paused,
  };
}

/**
 * B3: the governor's three bands. normal → economy (between economyAtUsd —
 * default the soft cap — and the hard cap) → halt. Economy REROUTES to
 * cheaper models (role-router overlay) instead of only pausing; halt keeps
 * the existing pause semantics.
 */
export async function governorMode(cfg) {
  const check = await checkCostBudget(cfg);
  const lim = check.limits || limits(cfg);
  const economyAt = cfg?.cost?.economyAtUsd ?? lim.dailySoftUsd;
  if (check.hard || check.paused) {
    return { mode: "halt", spentUsd: check.spentUsd, limits: lim };
  }
  if ((check.spentUsd || 0) >= economyAt) {
    return { mode: "economy", spentUsd: check.spentUsd, limits: lim, economyAt };
  }
  return { mode: "normal", spentUsd: check.spentUsd, limits: lim, economyAt };
}

export async function recordJobCost(cfg, { usd = 0, jobId = null } = {}) {
  let ledger = await loadLedger(cfg);
  if (ledger.day !== dayKey()) {
    ledger = { day: dayKey(), spentUsd: 0, jobs: 0, paused: false, events: [] };
  }
  const lim = limits(cfg);
  ledger.spentUsd = Math.round((ledger.spentUsd + Number(usd || 0)) * 1e6) / 1e6;
  ledger.jobs += 1;
  ledger.events = [
    ...(ledger.events || []).slice(-50),
    { at: new Date().toISOString(), usd, jobId },
  ];
  if (ledger.spentUsd >= lim.dailyHardUsd && lim.pauseQueueOnHard) {
    ledger.paused = true;
  }
  await saveLedger(cfg, ledger);
  return ledger;
}

export async function getCostGovernorStatus(cfg) {
  const check = await checkCostBudget(cfg);
  const ledger = await loadLedger(cfg);
  return { ...check, day: ledger.day, jobs: ledger.jobs, events: (ledger.events || []).slice(-5) };
}

export async function setCostGovernorPaused(cfg, paused) {
  const ledger = await loadLedger(cfg);
  ledger.paused = Boolean(paused);
  await saveLedger(cfg, ledger);
  return ledger;
}

/**
 * Rough USD from token usage. B3: one lookup path — getModelMeta owns the
 * rates-table matching (this function used to duplicate the substring
 * match). modelRef overrides cfg.agent.model when the router downshifted.
 */
export function estimateUsdFromUsage(usage, cfg = {}, { modelRef = null } = {}) {
  if (!usage) return 0;
  const ref = modelRef || cfg.agent?.model || "default";
  let rate;
  try {
    rate = getModelMeta(cfg, ref).cost;
  } catch {
    rate = cfg.tokens?.rates?.default || { in: 1e-6, out: 3e-6 };
  }
  if (!rate || (!rate.in && !rate.out)) {
    rate = cfg.tokens?.rates?.default || { in: 1e-6, out: 3e-6 };
  }
  const inn = usage.prompt_tokens || usage.input_tokens || 0;
  const out = usage.completion_tokens || usage.output_tokens || 0;
  return Math.round((inn * (rate.in || 0) + out * (rate.out || 0)) * 1e6) / 1e6;
}
