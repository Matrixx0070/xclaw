/**
 * Cost governor — soft/hard daily and per-job USD caps.
 *
 * cost-governor.json belongs to the config dir that owns the instance, not
 * to whoever's home dir the process happens to run under. Resolving it
 * from `os.homedir()` alone meant two instances on one host shared a
 * single daily spend/pause latch, so instance B's jobs mixed with
 * instance A's cap — and the suite wrote into the operator's real
 * `~/.xclaw/cost-governor.json`.
 *
 * Production loop (`recordJobCost(cfg)`), queue, doctor, tokens routes,
 * role-router, and fire-drill already had cfg in scope. `loadConfig()`
 * stamps `paths.configDir` unconditionally (config/load.mjs:187), so a
 * cfg without one is never a real caller. Such a path is `null` rather
 * than guessing at the home dir. Same shape as `defaultLedgerPath` /
 * `defaultStatePath`. Explicit `cost.governorPath` still wins.
 * `saveLedger` / `withLedgerLock` no-op a null path (do not `mkdir(null)`
 * / `"null.lock"`).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getModelMeta } from "../providers/registry.mjs";
import { stampJobCostEvent } from "../jobs/job-cost-attribution.mjs";

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function emptyLedger() {
  return { day: dayKey(), spentUsd: 0, jobs: 0, paused: false, events: [] };
}

/**
 * Honour `cost.governorPath` then `paths.configDir` then null.
 * No home fallback.
 */
export function governorLedgerPath(cfg) {
  const explicit = cfg?.cost?.governorPath;
  if (typeof explicit === "string" && explicit) return explicit;
  const dir = cfg?.paths?.configDir;
  return dir ? path.join(dir, "cost-governor.json") : null;
}

async function loadLedger(cfg) {
  const fp = governorLedgerPath(cfg);
  if (!fp) return emptyLedger();
  try {
    return JSON.parse(await fs.readFile(fp, "utf8"));
  } catch {
    return emptyLedger();
  }
}

async function saveLedger(cfg, ledger) {
  const fp = governorLedgerPath(cfg);
  if (!fp) return;
  await fs.mkdir(path.dirname(fp), { recursive: true });
  const tmp = `${fp}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  await fs.writeFile(tmp, JSON.stringify(ledger, null, 2));
  await fs.rename(tmp, fp);
}

/** Exclusive lock for ledger read-modify-write (concurrent recordJobCost). */
async function withLedgerLock(cfg, fn) {
  const fp = governorLedgerPath(cfg);
  if (!fp) return fn();
  const lockPath = fp + ".lock";
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const maxAttempts = 100;
  for (let i = 0; i < maxAttempts; i++) {
    let fh;
    try {
      fh = await fs.open(lockPath, "wx");
    } catch (e) {
      if (e?.code === "EEXIST") {
        await new Promise((r) => setTimeout(r, 5 + Math.floor(Math.random() * 20)));
        continue;
      }
      throw e;
    }
    try {
      return await fn();
    } finally {
      try { await fh.close(); } catch { /* */ }
      try { await fs.unlink(lockPath); } catch { /* */ }
    }
  }
  throw new Error("cost-governor: ledger lock timeout");
}

export function getCostLimits(cfg) {
  return limits(cfg);
}

function limits(cfg) {
  const g = cfg?.cost || cfg?.tokens?.cost || {};
  const autonomyCap = cfg?.autonomy?.maxUsdPerDay;
  // Two independent ceilings: the operator's cost cap and the autonomy-level
  // cap. The stricter one wins — with `??` the autonomy cap was silently
  // ignored whenever a cost cap existed, making it decorative.
  const explicitCap = g.dailyHardUsd;
  const autonomyNum = autonomyCap != null ? Number(autonomyCap) : null;
  const caps = [explicitCap, autonomyNum].filter(
    (v) => v != null && Number.isFinite(Number(v))
  );
  const dailyHard = caps.length ? Math.min(...caps.map(Number)) : 15;
  // The soft cap is the default `economyAtUsd` — the lower edge of the economy
  // band — and `bandFor` tests halt FIRST. So a soft cap that is not a number,
  // or that sits at or above the hard cap, does not merely warn late: it makes
  // the economy band unreachable and spending jumps normal -> halt with no
  // downshift. That is reachable without any malformed config: tightening
  // `autonomy.maxUsdPerDay` below the configured soft cap does it. Zero stays
  // zero — the strictest value is a value, not an absent one.
  const derivedSoft = Number.isFinite(dailyHard) ? Math.min(5, dailyHard * 0.5) : 5;
  const softRaw = g.dailySoftUsd == null ? null : Number(g.dailySoftUsd);
  const dailySoft =
    softRaw != null && softRaw < dailyHard
      ? Math.max(0, softRaw)
      : derivedSoft;
  // Same shape one line down: an unvalidated per-job cap makes every
  // `projected > lim.perJobUsd` comparison false, so no job is ever capped.
  const perJobCandidates = [g.perJobUsd, cfg?.agent?.maxUsdPerJob].filter(
    (v) => v != null && Number.isFinite(Number(v))
  );
  return {
    dailySoftUsd: dailySoft,
    dailyHardUsd: dailyHard,
    perJobUsd: perJobCandidates.length ? Number(perJobCandidates[0]) : 1,
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

async function recordJobCostUnlocked(cfg, { usd = 0, jobId = null, estimated = false, result = {} } = {}) {
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
    stampJobCostEvent({ usd, jobId, estimated, result }),
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

export async function recordJobCost(cfg, opts = {}) {
  return withLedgerLock(cfg, () => recordJobCostUnlocked(cfg, opts));
}

/** Owner-visible band-transition fanout: alerter (DM) + WS + ops ledger. */
async function notifyBandTransition(cfg, { from, to, ledger, lim, economyAt }) {
  const split =
    `total $${ledger.spentUsd.toFixed(2)} (billed $${(ledger.spentBilledUsd || 0).toFixed(2)}` +
    ` + estimated $${(ledger.spentEstimatedUsd || 0).toFixed(2)} — estimates use list prices;` +
    ` subscription/OAuth traffic is notional, not billed)`;
  const detail =
    to === "halt"
      // Name only remedies that exist. There is no /cost command and no `cost
      // resume` subcommand — and "until tomorrow" was itself false until
      // 3.322.0, because the halt latched the queue worker permanently.
      ? `Hard cap $${lim.dailyHardUsd} reached — queue paused, new jobs refused. Clears at the daily reset, or resume now from the control UI (Cost governor → Resume). ${split}`
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
