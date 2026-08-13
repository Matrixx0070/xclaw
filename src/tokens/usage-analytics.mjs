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
  const agg = await readCostLedger(ledger, {});
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
    providersSeen.add(inferProvider(e));
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
    providersSeen: [...providersSeen],
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

export default { usageSummary, requestLogs, requestLogDetail, inferProvider };
