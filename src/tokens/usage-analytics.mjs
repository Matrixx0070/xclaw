/**
 * Usage & Logs analytics over the cost ledger (JSONL) — the data behind the
 * control UI's per-provider Usage & Logs views.
 *
 * The ledger's run entries already carry per-request detail in `turns[]`
 * (prompt/completion/reasoning/cached tokens + per-turn cost), so this module
 * aggregates rather than inventing a second store. Entries written before
 * 3.95.0 lack a `provider` field — those are inferred from the model name.
 */
import { readCostLedger, defaultLedgerPath } from "./usage-tracker.mjs";

const MODEL_PROVIDER_HINTS = [
  [/^claude/i, "anthropic"],
  [/^grok/i, "xai"],
  [/^gpt|^o[0-9]|^chatgpt/i, "openai"],
  [/^gemini/i, "google"],
  [/^deepseek/i, "deepseek"],
  [/^mistral|^codestral|^ministral/i, "mistral"],
  [/^llama|^meta\//i, "ollama"],
  [/^nvidia\/|^nemotron/i, "nvidia"],
];

export function inferProvider(entry) {
  if (entry?.provider) return String(entry.provider).toLowerCase();
  const model = String(entry?.model || "");
  for (const [re, prov] of MODEL_PROVIDER_HINTS) {
    if (re.test(model)) return prov;
  }
  return "unknown";
}

function dayKey(iso) {
  return String(iso || "").slice(0, 10);
}

async function loadEntries(cfg, { provider = null, sinceMs = null } = {}) {
  const ledger = cfg?.tokens?.ledgerPath || defaultLedgerPath();
  const agg = await readCostLedger(ledger, { limit: 0 }); // all rows for analytics
  const rows = agg.rows || [];
  const want = provider && provider !== "all" ? String(provider).toLowerCase() : null;
  return {
    path: agg.path,
    // _idx = position in the UNFILTERED ledger — synthetic run ids for
    // legacy entries (no runId field) are derived from it, so it must be
    // stable regardless of which provider filter produced the row.
    entries: rows
      .map((e, i) => ({ ...e, _idx: i }))
      .filter((e) => {
        if (sinceMs && new Date(e.at).getTime() < sinceMs) return false;
        if (want && inferProvider(e) !== want) return false;
        return true;
      }),
  };
}

function entryRunId(e) {
  return e.runId || `${e.at}#${e._idx}`;
}

/**
 * Per-provider usage summary: daily buckets + token-type breakdown + models.
 * @param {object} cfg
 * @param {object} [opts]
 * @param {string} [opts.provider] provider id or "all"
 * @param {number} [opts.days] window (default 7)
 */
export async function usageSummary(cfg, { provider = "all", days = 7 } = {}) {
  const nDays = Math.min(90, Math.max(1, Number(days) || 7));
  const sinceMs = Date.now() - nDays * 86_400_000;
  const { entries, path } = await loadEntries(cfg, { provider, sinceMs });

  const buckets = new Map(); // day → agg
  const totals = {
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    costUsd: 0,
    requests: 0,
    runs: 0,
  };
  const byModel = new Map();
  const byProvider = new Map();
  const providersSeen = new Set();

  for (const e of entries) {
    const day = dayKey(e.at);
    let b = buckets.get(day);
    if (!b) {
      b = { day, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cachedTokens: 0, costUsd: 0, requests: 0, runs: 0 };
      buckets.set(day, b);
    }
    const turns = Array.isArray(e.turns) && e.turns.length ? e.turns : [e];
    b.runs += 1;
    totals.runs += 1;
    const prov = inferProvider(e);
    providersSeen.add(prov);
    const pv = byProvider.get(prov) || {
      provider: prov,
      runs: 0,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
    };
    pv.runs += 1;
    pv.promptTokens += e.promptTokens || 0;
    pv.completionTokens += e.completionTokens || 0;
    pv.costUsd += e.costUsd || 0;
    byProvider.set(prov, pv);
    for (const t of turns) {
      b.promptTokens += t.promptTokens || 0;
      b.completionTokens += t.completionTokens || 0;
      b.reasoningTokens += t.reasoningTokens || 0;
      b.cachedTokens += t.cachedTokens || 0;
      b.costUsd += t.costUsd || 0;
      b.requests += 1;
      totals.promptTokens += t.promptTokens || 0;
      totals.completionTokens += t.completionTokens || 0;
      totals.reasoningTokens += t.reasoningTokens || 0;
      totals.cachedTokens += t.cachedTokens || 0;
      totals.costUsd += t.costUsd || 0;
      totals.requests += 1;
    }
    const mk = e.model || "unknown";
    const mv = byModel.get(mk) || { model: mk, runs: 0, tokens: 0, costUsd: 0 };
    mv.runs += 1;
    mv.tokens += e.totalTokens || 0;
    mv.costUsd += e.costUsd || 0;
    byModel.set(mk, mv);
  }

  // continuous day axis (oldest → newest), zero-filled
  const daysOut = [];
  for (let i = nDays - 1; i >= 0; i--) {
    const d = dayKey(new Date(Date.now() - i * 86_400_000).toISOString());
    daysOut.push(
      buckets.get(d) ||
        { day: d, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cachedTokens: 0, costUsd: 0, requests: 0, runs: 0 }
    );
  }

  return {
    ok: true,
    provider: provider || "all",
    days: nDays,
    path,
    totals: {
      ...totals,
      totalTokens:
        totals.promptTokens + totals.completionTokens + totals.reasoningTokens,
    },
    breakdown: [
      { type: "prompt", label: "Prompt tokens", tokens: totals.promptTokens },
      { type: "cached", label: "Cached prompt tokens", tokens: totals.cachedTokens },
      { type: "completion", label: "Completion tokens", tokens: totals.completionTokens },
      { type: "reasoning", label: "Reasoning tokens", tokens: totals.reasoningTokens },
    ],
    daily: daysOut,
    byModel: [...byModel.values()].sort((a, b) => b.tokens - a.tokens),
    byProvider: [...byProvider.values()].sort((a, b) => b.costUsd - a.costUsd),
    providersSeen: [...providersSeen],
  };
}

/**
 * Composite dashboard payload for Control UI overview + Usage page.
 */
export async function buildUsageDashboard(cfg, { days = 7 } = {}) {
  const summary = await usageSummary(cfg, { provider: "all", days });
  let governor = null;
  try {
    const { getCostGovernorStatus, governorMode } = await import("./cost-governor.mjs");
    const status = await getCostGovernorStatus(cfg);
    const mode = await governorMode(cfg);
    governor = {
      ...status,
      mode: mode.mode,
      economyAt: mode.economyAt,
      spentBilledUsd: status.spentUsd, // status merges check; file has split
    };
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const os = await import("node:os");
      const base = cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw");
      const raw = JSON.parse(await fs.readFile(path.join(base, "cost-governor.json"), "utf8"));
      governor.spentBilledUsd = raw.spentBilledUsd || 0;
      governor.spentEstimatedUsd = raw.spentEstimatedUsd || 0;
      governor.lastBand = raw.lastBand || mode.mode;
    } catch {
      /* optional */
    }
  } catch (e) {
    governor = { error: e.message };
  }
  const recent = await requestLogs(cfg, { provider: "all", limit: 15 });
  const efficiency = await providerEfficiency(cfg, { days });
  return {
    ok: true,
    at: new Date().toISOString(),
    usage: summary,
    governor,
    efficiency,
    recentLogs: recent.rows || [],
  };
}


/**
 * Flattened request log (newest first): one row per API request (turn).
 * @param {object} [opts.q] substring filter over model/session/preview/runId
 */
export async function requestLogs(cfg, { provider = "all", limit = 50, model = null, q = null } = {}) {
  const { entries, path } = await loadEntries(cfg, { provider });
  const out = [];
  for (let i = entries.length - 1; i >= 0 && out.length < 5000; i--) {
    const e = entries[i];
    const prov = inferProvider(e);
    const runId = entryRunId(e);
    const turns = Array.isArray(e.turns) && e.turns.length ? e.turns : [{ turn: 1, ...e }];
    for (let ti = turns.length - 1; ti >= 0; ti--) {
      const t = turns[ti];
      out.push({
        runId,
        turn: t.turn ?? ti + 1,
        at: e.at,
        provider: prov,
        model: e.model || "unknown",
        promptTokens: t.promptTokens ?? null,
        completionTokens: t.completionTokens ?? null,
        cachedTokens: t.cachedTokens ?? null,
        reasoningTokens: t.reasoningTokens ?? null,
        costUsd: t.costUsd ?? null,
        estimated: t.estimated === true || e.hasRealUsage === false,
        sessionId: e.sessionId || null,
        preview: e.userMessagePreview || null,
      });
    }
  }
  let rows = out;
  if (model) rows = rows.filter((r) => r.model === model);
  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter((r) =>
      [r.runId, r.model, r.sessionId, r.preview]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle))
    );
  }
  const lim = Math.min(500, Math.max(1, Number(limit) || 50));
  return { ok: true, provider: provider || "all", path, total: rows.length, rows: rows.slice(0, lim) };
}

/** Full ledger entry for one run (the log drill-down). */
export async function requestLogDetail(cfg, runId) {
  const { entries } = await loadEntries(cfg, {});
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const id = entryRunId(e);
    if (id === runId) {
      const { _idx, ...entry } = e;
      return { ok: true, entry: { ...entry, runId: id, provider: inferProvider(e) } };
    }
  }
  return { ok: false, error: "run not found" };
}


/**
 * Token efficiency per provider: cost intensity, cache leverage, I/O mix.
 *
 * Metrics (higher is better unless noted):
 *   tokensPerUsd     — total tokens per $1 spent
 *   usdPer1MTokens   — blended $ per 1M tokens (lower better)
 *   cacheHitRate     — cached_prompt / prompt
 *   outInRatio       — completion / prompt (workload shape)
 *   costPerRun       — $ / run
 *   estimatedShare   — fraction of $ that is estimated (not billed)
 */
export async function providerEfficiency(cfg, { days = 7 } = {}) {
  const nDays = Math.min(90, Math.max(1, Number(days) || 7));
  const sinceMs = Date.now() - nDays * 86_400_000;
  const { entries, path } = await loadEntries(cfg, { sinceMs });

  const by = new Map();
  for (const e of entries) {
    const prov = inferProvider(e);
    let s = by.get(prov);
    if (!s) {
      s = {
        provider: prov,
        runs: 0,
        promptTokens: 0,
        completionTokens: 0,
        reasoningTokens: 0,
        cachedTokens: 0,
        costUsd: 0,
        estimatedCostUsd: 0,
        billedCostUsd: 0,
        turns: 0,
        estimatedTurns: 0,
      };
      by.set(prov, s);
    }
    s.runs += 1;
    const turns = Array.isArray(e.turns) && e.turns.length ? e.turns : [e];
    for (const t of turns) {
      s.turns += 1;
      s.promptTokens += t.promptTokens || 0;
      s.completionTokens += t.completionTokens || 0;
      s.reasoningTokens += t.reasoningTokens || 0;
      s.cachedTokens += t.cachedTokens || 0;
      const c = Number(t.costUsd) || 0;
      s.costUsd += c;
      if (t.estimated === true || e.hasRealUsage === false || e.costEstimated === true) {
        s.estimatedCostUsd += c;
        s.estimatedTurns += 1;
      } else {
        s.billedCostUsd += c;
      }
    }
    // entry-level cost if turns lacked costUsd
    if (!(Array.isArray(e.turns) && e.turns.some((t) => t.costUsd != null)) && typeof e.costUsd === "number") {
      // already counted via [e] as single turn above when no turns
    }
  }

  const providers = [...by.values()].map((s) => {
    const totalTokens =
      s.promptTokens + s.completionTokens + s.reasoningTokens;
    const usd = s.costUsd || 0;
    const cacheHitRate =
      s.promptTokens > 0 ? Math.min(1, s.cachedTokens / s.promptTokens) : 0;
    const outInRatio =
      s.promptTokens > 0 ? s.completionTokens / s.promptTokens : null;
    return {
      provider: s.provider,
      runs: s.runs,
      turns: s.turns,
      promptTokens: s.promptTokens,
      completionTokens: s.completionTokens,
      reasoningTokens: s.reasoningTokens,
      cachedTokens: s.cachedTokens,
      totalTokens,
      costUsd: Math.round(usd * 1e6) / 1e6,
      billedCostUsd: Math.round(s.billedCostUsd * 1e6) / 1e6,
      estimatedCostUsd: Math.round(s.estimatedCostUsd * 1e6) / 1e6,
      estimatedShare:
        usd > 0 ? Math.round((s.estimatedCostUsd / usd) * 1000) / 1000 : 0,
      tokensPerUsd: usd > 0 ? Math.round(totalTokens / usd) : null,
      usdPer1MTokens:
        totalTokens > 0 ? Math.round((usd / totalTokens) * 1e6 * 1e4) / 1e4 : null,
      cacheHitRate: Math.round(cacheHitRate * 1000) / 1000,
      cacheHitRatePct: Math.round(cacheHitRate * 1000) / 10,
      outInRatio: outInRatio != null ? Math.round(outInRatio * 1000) / 1000 : null,
      costPerRun: s.runs > 0 ? Math.round((usd / s.runs) * 1e6) / 1e6 : null,
      avgPromptPerTurn:
        s.turns > 0 ? Math.round(s.promptTokens / s.turns) : null,
    };
  });

  providers.sort((a, b) => (b.tokensPerUsd || 0) - (a.tokensPerUsd || 0));

  // Rankings: efficiency champions
  const withSpend = providers.filter((p) => p.costUsd > 0 && p.totalTokens > 0);
  const bestTokensPerUsd = withSpend[0] || null;
  const bestCache = [...withSpend].sort(
    (a, b) => b.cacheHitRate - a.cacheHitRate
  )[0] || null;
  const cheapestBlended = [...withSpend].sort(
    (a, b) => (a.usdPer1MTokens || 9e9) - (b.usdPer1MTokens || 9e9)
  )[0] || null;

  return {
    ok: true,
    days: nDays,
    path,
    providers,
    rankings: {
      mostTokensPerUsd: bestTokensPerUsd?.provider || null,
      bestCacheHitRate: bestCache?.provider || null,
      lowestUsdPer1M: cheapestBlended?.provider || null,
    },
    notes: [
      "tokensPerUsd = (prompt+completion+reasoning) / $ — higher is more efficient",
      "usdPer1MTokens is blended realized cost, not list price",
      "cacheHitRate uses provider-reported cached tokens when present",
      "estimatedShare high ⇒ prefer billed ticks (cost_in_usd_ticks) for accuracy",
    ],
  };
}

export default { usageSummary, requestLogs, requestLogDetail, inferProvider, buildUsageDashboard, providerEfficiency };
