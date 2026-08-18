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

export function getCostLimits(cfg) {
  return limits(cfg);
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

/** Band for a given spent figure — shared by governorMode + transition detection. */
function bandFor(spent, lim, paused, economyAt) {
  if (paused || spent >= lim.dailyHardUsd) return "halt";
  if (spent >= economyAt) return "economy";
  return "normal";
}

export async function recordJobCost(cfg, { usd = 0, jobId = null, estimated = false } = {}) {
  let ledger = await loadLedger(cfg);
  if (ledger.day !== dayKey()) {
    ledger = {
      day: dayKey(),
      spentUsd: 0,
      spentBilledUsd: 0,
      spentEstimatedUsd: 0,
      jobs: 0,
      paused: false,
      events: [],
      lastBand: "normal",
    };
  }
  const lim = limits(cfg);
  const economyAt = cfg?.cost?.economyAtUsd ?? lim.dailySoftUsd;
  const prevBand = bandFor(ledger.spentUsd || 0, lim, ledger.paused, economyAt);
  ledger.spentUsd = Math.round((ledger.spentUsd + Number(usd || 0)) * 1e6) / 1e6;
  // Estimated (list-price, often subscription-notional for OAuth) vs billed
  // (provider-returned) tracked separately so band alerts can be honest
  // about what the number means. spentUsd stays the combined total for
  // back-compat with every existing reader.
  const bucket = estimated ? "spentEstimatedUsd" : "spentBilledUsd";
  ledger[bucket] = Math.round(((ledger[bucket] || 0) + Number(usd || 0)) * 1e6) / 1e6;
  ledger.jobs += 1;
  ledger.events = [
    ...(ledger.events || []).slice(-50),
    { at: new Date().toISOString(), usd, jobId },
  ];
  if (ledger.spentUsd >= lim.dailyHardUsd && lim.pauseQueueOnHard) {
    ledger.paused = true;
  }
  const newBand = bandFor(ledger.spentUsd, lim, ledger.paused, economyAt);
  if (newBand !== prevBand) {
    // Band changes used to be SILENT: economy could downshift models and
    // halt paused the queue/refused jobs with no owner signal — armed for
    // real the day estimated pricing landed. Journal + alert + WS.
    ledger.events = [
      ...ledger.events.slice(-49),
      { at: new Date().toISOString(), kind: "band", from: prevBand, to: newBand },
    ];
    ledger.lastBand = newBand;
    notifyBandTransition(cfg, { from: prevBand, to: newBand, ledger, lim, economyAt }).catch(() => {});
  }
  await saveLedger(cfg, ledger);
  return ledger;
}

/** Owner-visible band-transition fanout: alerter (DM) + WS + ops ledger. */
async function notifyBandTransition(cfg, { from, to, ledger, lim, economyAt }) {
  const split =
    `total $${ledger.spentUsd.toFixed(2)} (billed $${(ledger.spentBilledUsd || 0).toFixed(2)}` +
    ` + estimated $${(ledger.spentEstimatedUsd || 0).toFixed(2)} — estimates use list prices;` +
    ` subscription/OAuth traffic is notional, not billed)`;
  const detail =
    to === "halt"
      ? `Hard cap $${lim.dailyHardUsd} reached — queue paused, new jobs refused until tomorrow or /cost resume. ${split}`
      : to === "economy"
        ? `Economy threshold $${economyAt} reached — role router may reroute to cheaper models (if configured). ${split}`
        : `Back to normal. ${split}`;
  try {
    globalThis.__xclawWsBroadcast?.("security", {
      type: "cost",
      phase: "band",
      from,
      to,
      spentUsd: ledger.spentUsd,
    });
  } catch {
    /* hub optional */
  }
  try {
    const { getSharedLedger } = await import("../ops/ledger.mjs");
    getSharedLedger(cfg).append({
      kind: "phase",
      actor: "governor",
      ids: {},
      data: { phase: "cost_band", from, to, spentUsd: ledger.spentUsd },
    });
  } catch {
    /* ledger best-effort */
  }
  try {
    const { getSharedAlerter } = await import("../alerting/alerts.mjs");
    await getSharedAlerter(cfg).send({
      key: `cost-band:${to}`,
      // escalations use "error" so they clear the alerter's default
      // minSeverity ("error") and actually reach the owner's DM; the
      // recovery info is WS/ledger-visible without paging
      severity: to === "normal" ? "info" : "error",
      title: `Cost governor: ${from} → ${to}`,
      body: detail,
      meta: { from, to, spentUsd: ledger.spentUsd, day: ledger.day },
    });
  } catch {
    /* alerting best-effort */
  }
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
/** Prompt tokens threshold for xAI-style long-context 2x band. */
export const LONG_CONTEXT_PROMPT_TOKENS = 200_000;

/**
 * Rough USD from token usage. Uses list rates from getModelMeta.
 * Long-context: when prompt ≥ 200k and rate has longIn/longOut, bill the
 * whole request at the long band (matches xAI: higher rate for ALL tokens).
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
  const inn = Number(
    usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? 0
  ) || 0;
  const out = Number(
    usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens ?? 0
  ) || 0;
  const cached = Number(
    usage.cached_tokens ?? usage.cache_read_input_tokens ?? usage.cachedTokens ?? 0
  ) || 0;

  const long =
    inn >= LONG_CONTEXT_PROMPT_TOKENS &&
    (rate.longIn != null || rate.longOut != null);
  const inRate = long ? (rate.longIn ?? rate.in * 2) : rate.in || 0;
  const outRate = long ? (rate.longOut ?? rate.out * 2) : rate.out || 0;
  const cachedRate = long
    ? (rate.longCachedIn ?? rate.cachedIn ?? inRate)
    : (rate.cachedIn ?? inRate);

  // Bill non-cached input at full rate; cached portion at cached rate when known
  const uncachedIn = Math.max(0, inn - cached);
  const usd =
    uncachedIn * inRate +
    cached * cachedRate +
    out * outRate;
  return Math.round(usd * 1e6) / 1e6;
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
