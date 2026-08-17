/**
 * Cost governor — soft/hard daily and per-job USD caps.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

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
  const autonomyCap = cfg?.autonomy?.maxUsdPerDay;
  const dailyHard =
    g.dailyHardUsd ??
    (autonomyCap != null ? Number(autonomyCap) : 15);
  const dailySoft =
    g.dailySoftUsd ??
    (Number.isFinite(dailyHard) ? Math.min(5, dailyHard * 0.5) : 5);
  return {
    dailySoftUsd: dailySoft,
    dailyHardUsd: dailyHard,
    perJobUsd: g.perJobUsd ?? cfg?.agent?.maxUsdPerJob ?? 1,
    pauseQueueOnHard: g.pauseQueueOnHard !== false,
    strict: g.strict === true || cfg?.cost?.strict === true,
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
  if (ledger.paused && lim.pauseQueueOnHard) {
    return {
      ok: false,
      hard: true,
      soft: true,
      code: "BUDGET_EXCEEDED",
      scope: "day",
      spentUsd: ledger.spentUsd,
      limitUsd: lim.dailyHardUsd,
      limits: lim,
      paused: true,
      message: `Cost governor paused (hard cap). spent=$${Number(ledger.spentUsd).toFixed(4)} limit=$${lim.dailyHardUsd}`,
    };
  }
  if (projected > lim.dailyHardUsd) {
    return {
      ok: false,
      hard: true,
      soft: true,
      code: "BUDGET_EXCEEDED",
      scope: "day",
      spentUsd: ledger.spentUsd,
      limitUsd: lim.dailyHardUsd,
      limits: lim,
      paused: ledger.paused,
      message: `Hard daily cap $${lim.dailyHardUsd} exceeded (spent $${Number(ledger.spentUsd).toFixed(4)})`,
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

/** Rough USD from token usage using cfg rates */
export function estimateUsdFromUsage(usage, cfg = {}) {
  if (!usage) return 0;
  const rates = cfg.tokens?.rates || {
    "grok-4": { in: 3e-6, out: 15e-6 },
    default: { in: 1e-6, out: 3e-6 },
  };
  const model = cfg.agent?.model || "default";
  let rate = rates.default;
  for (const k of Object.keys(rates).sort((a, b) => b.length - a.length)) {
    if (k !== "default" && model.includes(k)) {
      rate = rates[k];
      break;
    }
  }
  const inn = usage.prompt_tokens || usage.input_tokens || 0;
  const out = usage.completion_tokens || usage.output_tokens || 0;
  return Math.round((inn * (rate.in || 0) + out * (rate.out || 0)) * 1e6) / 1e6;
}


/**
 * Per-job cumulative spend gate.
 * @param {number} jobSpentUsd
 * @returns {{ ok: boolean, code?: string, scope?: string, spentUsd: number, limitUsd: number, message?: string }}
 */
export function checkJobCostBudget(cfg, jobSpentUsd = 0, estimateUsd = 0) {
  const lim = limits(cfg);
  const spent = Number(jobSpentUsd) || 0;
  const projected = spent + (Number(estimateUsd) || 0);
  if (projected > lim.perJobUsd) {
    return {
      ok: false,
      code: "BUDGET_EXCEEDED",
      scope: "job",
      spentUsd: spent,
      limitUsd: lim.perJobUsd,
      message: `Per-job cap $${lim.perJobUsd} exceeded (spent $${spent.toFixed(4)})`,
    };
  }
  return { ok: true, spentUsd: spent, limitUsd: lim.perJobUsd };
}
