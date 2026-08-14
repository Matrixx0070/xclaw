/**
 * Accumulates real provider usage + cost across agent turns.
 * xAI: cost_in_usd_ticks / 1e10 = USD (exact billed amount).
 */
import { normalizeUsage, estimateRequestTokens } from "./count.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const TICKS_PER_USD = 10_000_000_000;

export function ticksToUsd(ticks) {
  if (ticks == null || !Number.isFinite(Number(ticks))) return null;
  return Number(ticks) / TICKS_PER_USD;
}

export function formatUsd(n, digits = 6) {
  if (n == null || !Number.isFinite(n)) return "n/a";
  if (n === 0) return "$0";
  if (n < 0.000001) return `$${n.toExponential(2)}`;
  if (n < 0.01) return `$${n.toFixed(Math.max(digits, 6))}`;
  return `$${n.toFixed(4)}`;
}

export function createUsageTracker({ enabled = true, model = null, ledgerPath = null } = {}) {
  const state = {
    enabled,
    model,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    costInUsdTicks: 0,
    costUsd: 0,
    hasCost: false,
    estimatedPromptTokens: null,
    hasRealUsage: false,
    usedFallback: false,
    fallbackReasons: [],
    turns: [],
    mode: "none",
  };

  function noteFallback(reason) {
    if (!reason) return;
    state.usedFallback = true;
    if (state.fallbackReasons.length < 8) {
      state.fallbackReasons.push(reason);
    }
  }

  function setInitialEstimate(est) {
    if (!enabled || !est) return;
    state.estimatedPromptTokens = est.promptTokens ?? null;
    state.mode = est.mode || state.mode;
    if (est.fallback) noteFallback(est.fallback);
  }

  function recordTurn({ turn, usage, estimate, elapsedMs = null, modelRef = null }) {
    if (!enabled) return null;

    const norm = normalizeUsage(usage);
    if (norm && (norm.promptTokens != null || norm.completionTokens != null || norm.totalTokens != null || norm.costUsd != null)) {
      state.hasRealUsage = true;
      state.mode = "usage";
      const prompt = norm.promptTokens || 0;
      const completion = norm.completionTokens || 0;
      const total =
        norm.totalTokens != null ? norm.totalTokens : prompt + completion;

      state.promptTokens += prompt;
      state.completionTokens += completion;
      state.totalTokens += total;

      if (norm.reasoningTokens) state.reasoningTokens += norm.reasoningTokens;
      if (norm.cachedTokens) state.cachedTokens += norm.cachedTokens;

      if (norm.costInUsdTicks != null) {
        state.costInUsdTicks += norm.costInUsdTicks;
        state.hasCost = true;
      }
      if (norm.costUsd != null) {
        state.costUsd += norm.costUsd;
        state.hasCost = true;
      } else if (norm.costInUsdTicks != null) {
        state.costUsd = ticksToUsd(state.costInUsdTicks);
        state.hasCost = true;
      }

      const entry = {
        turn,
        promptTokens: prompt,
        completionTokens: completion,
        totalTokens: total,
        reasoningTokens: norm.reasoningTokens ?? null,
        cachedTokens: norm.cachedTokens ?? null,
        costInUsdTicks: norm.costInUsdTicks ?? null,
        costUsd: norm.costUsd ?? null,
        estimated: false,
        mode: "usage",
        // B3 economics: measured latency + which model actually served
        elapsedMs: elapsedMs ?? null,
        modelRef: modelRef || null,
      };
      state.turns.push(entry);
      return entry;
    }

    if (usage != null && !norm) {
      noteFallback("usage_unparseable");
    } else if (usage == null) {
      noteFallback("usage_missing");
    }

    if (estimate) {
      const prompt = estimate.promptTokens || 0;
      if (!state.hasRealUsage) {
        state.mode = estimate.mode || "heuristic";
      }
      if (estimate.fallback) noteFallback(estimate.fallback);

      const entry = {
        turn,
        promptTokens: prompt,
        completionTokens: null,
        totalTokens: null,
        costUsd: null,
        estimated: true,
        mode: estimate.mode || "heuristic",
        fallback: estimate.fallback || (usage == null ? "usage_missing" : "usage_unparseable"),
      };
      state.turns.push(entry);

      if (!state.hasRealUsage) {
        state.promptTokens += prompt;
      }
      return entry;
    }

    noteFallback("no_estimate");
    const entry = {
      turn,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      costUsd: null,
      estimated: true,
      mode: "unknown",
      fallback: "no_data",
    };
    state.turns.push(entry);
    return entry;
  }

  function snapshot() {
    if (!enabled) return null;
    return {
      promptTokens: state.promptTokens,
      completionTokens: state.completionTokens,
      totalTokens: state.totalTokens,
      reasoningTokens: state.reasoningTokens,
      cachedTokens: state.cachedTokens,
      costInUsdTicks: state.hasCost ? state.costInUsdTicks : null,
      costUsd: state.hasCost ? state.costUsd : null,
      costUsdFormatted: state.hasCost ? formatUsd(state.costUsd) : null,
      estimatedPromptTokens: state.estimatedPromptTokens,
      hasRealUsage: state.hasRealUsage,
      hasCost: state.hasCost,
      usedFallback: state.usedFallback,
      fallbackReasons: state.fallbackReasons.slice(),
      mode: state.mode,
      turns: state.turns.map((t) => ({ ...t })),
      model: state.model,
    };
  }

  function formatSummary() {
    const s = snapshot();
    if (!s) return "";
    if (s.hasRealUsage) {
      let line = `tokens in=${s.promptTokens} out=${s.completionTokens} total=${s.totalTokens}`;
      if (s.hasCost) line += ` · cost ${formatUsd(s.costUsd)}`;
      if (s.reasoningTokens) line += ` · reason=${s.reasoningTokens}`;
      if (s.cachedTokens) line += ` · cached=${s.cachedTokens}`;
      if (s.usedFallback) line += ` (partial fallbacks)`;
      return line;
    }
    if (s.estimatedPromptTokens != null) {
      const why = s.fallbackReasons[0] ? ` · ${s.fallbackReasons[0]}` : "";
      return `tokens ~prompt=${s.estimatedPromptTokens} (${s.mode}${why})`;
    }
    return "tokens n/a";
  }

  /** Append this run's snapshot to a JSONL ledger (best-effort). */
  async function persistLedger(extra = {}) {
    if (!enabled || !ledgerPath) return null;
    try {
      await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
      const line = JSON.stringify({
        at: new Date().toISOString(),
        ...snapshot(),
        ...extra,
      });
      await fs.appendFile(ledgerPath, line + "\n", "utf8");
      return ledgerPath;
    } catch (err) {
      console.warn("[xclaw] cost ledger write failed:", err.message);
      return null;
    }
  }

  return {
    setInitialEstimate,
    recordTurn,
    snapshot,
    formatSummary,
    persistLedger,
    get enabled() {
      return enabled;
    },
  };
}

/**
 * Read JSONL cost ledger and aggregate.
 */
export async function readCostLedger(ledgerPath, { since = null } = {}) {
  try {
    const raw = await fs.readFile(ledgerPath, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const sinceMs = since ? Date.parse(since) : null;
    const rows = [];
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (sinceMs && row.at && Date.parse(row.at) < sinceMs) continue;
        rows.push(row);
      } catch {
        /* skip bad line */
      }
    }
    let costUsd = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let runs = 0;
    for (const r of rows) {
      runs++;
      if (typeof r.costUsd === "number") costUsd += r.costUsd;
      if (typeof r.promptTokens === "number") promptTokens += r.promptTokens;
      if (typeof r.completionTokens === "number") completionTokens += r.completionTokens;
    }
    return {
      path: ledgerPath,
      runs,
      promptTokens,
      completionTokens,
      costUsd,
      costUsdFormatted: formatUsd(costUsd),
      rows: rows.slice(-50), // last 50
    };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { path: ledgerPath, runs: 0, promptTokens: 0, completionTokens: 0, costUsd: 0, costUsdFormatted: "$0", rows: [] };
    }
    throw err;
  }
}

export function defaultLedgerPath() {
  return path.join(os.homedir(), ".xclaw", "cost-ledger.jsonl");
}

export { estimateRequestTokens, normalizeUsage, TICKS_PER_USD };
