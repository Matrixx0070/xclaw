/**
 * Correlate prompt-cache hits with tool usage.
 *
 * Provider cache stats are per *model turn*, not per tool call.
 * We attribute a turn's cache metrics to the tools that appeared in the
 * *previous* assistant message (those tool results were appended and may
 * change the uncached suffix while the system prefix stays cached).
 */

import { cacheStatsFromUsage } from "./cache-strategy.mjs";

/**
 * @typedef {{ turn: number, tools: string[], promptTokens: number, cachedTokens: number, uncachedTokens: number, hitRate: number, costUsd?: number|null }} TurnCacheRow
 * @typedef {{ tool: string, turns: number, promptTokens: number, cachedTokens: number, uncachedTokens: number, hitRate: number, avgHitRate: number, costUsd: number }} ToolCacheRow
 */

/**
 * Build per-turn rows from agent toolTrace + usage.turns.
 *
 * usage.turns[i] is the model call for turn i+1.
 * toolTrace entries are in execution order within those turns.
 *
 * @param {object} opts
 * @param {Array} opts.usageTurns  from usageTracker.snapshot().turns
 * @param {Array} opts.toolTrace   from runAgentLoop result.toolTrace
 * @param {Array} [opts.events]    optional onEvent log with {type:'tool', phase:'start', name}
 */
export function analyzeCacheByTool({ usageTurns = [], toolTrace = [], events = [] } = {}) {
  const turns = (usageTurns || []).filter((t) => !t.estimated);

  // Reconstruct tools per model turn from events if available (best),
  // else dump all toolTrace onto turns that had tool activity via a simple split.
  const toolsByTurn = mapToolsToTurns({ turns, toolTrace, events });

  /** @type {TurnCacheRow[]} */
  const turnRows = turns.map((t, idx) => {
    const prompt = t.promptTokens || 0;
    const cached = t.cachedTokens || 0;
    const uncached = Math.max(0, prompt - cached);
    const hitRate = prompt > 0 ? cached / prompt : 0;
    return {
      turn: t.turn ?? idx + 1,
      tools: toolsByTurn[idx] || [],
      promptTokens: prompt,
      cachedTokens: cached,
      uncachedTokens: uncached,
      hitRate,
      hitRatePct: Number((hitRate * 100).toFixed(1)),
      costUsd: t.costUsd ?? null,
    };
  });

  // Attribute each turn's cache stats to tools that *fed* this turn
  // (tools executed at end of previous turn). Turn 1 has no prior tools.
  /** @type {Map<string, { turns: number, promptTokens: number, cachedTokens: number, uncachedTokens: number, costUsd: number, hitRates: number[] }>} */
  const byTool = new Map();

  function bump(tool, row) {
    if (!tool) return;
    let agg = byTool.get(tool);
    if (!agg) {
      agg = {
        turns: 0,
        promptTokens: 0,
        cachedTokens: 0,
        uncachedTokens: 0,
        costUsd: 0,
        hitRates: [],
      };
      byTool.set(tool, agg);
    }
    agg.turns += 1;
    agg.promptTokens += row.promptTokens;
    agg.cachedTokens += row.cachedTokens;
    agg.uncachedTokens += row.uncachedTokens;
    if (typeof row.costUsd === "number") agg.costUsd += row.costUsd;
    agg.hitRates.push(row.hitRate);
  }

  for (let i = 0; i < turnRows.length; i++) {
    const row = turnRows[i];
    // Tools that caused the *next* prompt to grow are those from previous turn
    const priorTools = i === 0 ? [] : turnRows[i - 1].tools;
    if (priorTools.length === 0) {
      bump("(no_prior_tool)", row);
    } else {
      // Attribute fully to each prior tool (same turn stats counted per tool —
      // interpret as "cache profile when this tool was in context")
      for (const tool of priorTools) bump(tool, row);
    }
    // Also tag tools *called in this turn* under a separate view for completeness
  }

  /** @type {ToolCacheRow[]} */
  const tools = [...byTool.entries()]
    .map(([tool, a]) => {
      const hitRate = a.promptTokens > 0 ? a.cachedTokens / a.promptTokens : 0;
      const avgHitRate =
        a.hitRates.length > 0
          ? a.hitRates.reduce((x, y) => x + y, 0) / a.hitRates.length
          : 0;
      return {
        tool,
        turns: a.turns,
        promptTokens: a.promptTokens,
        cachedTokens: a.cachedTokens,
        uncachedTokens: a.uncachedTokens,
        hitRate,
        hitRatePct: Number((hitRate * 100).toFixed(1)),
        avgHitRate,
        avgHitRatePct: Number((avgHitRate * 100).toFixed(1)),
        costUsd: a.costUsd,
      };
    })
    .sort((a, b) => b.promptTokens - a.promptTokens);

  // Tool result size impact from toolTrace
  const toolResultSizes = summarizeToolResultSizes(toolTrace);

  return {
    turns: turnRows,
    byTool: tools,
    toolResultSizes,
    summary: {
      totalPrompt: turnRows.reduce((s, r) => s + r.promptTokens, 0),
      totalCached: turnRows.reduce((s, r) => s + r.cachedTokens, 0),
      overallHitRatePct:
        turnRows.reduce((s, r) => s + r.promptTokens, 0) > 0
          ? Number(
              (
                (100 * turnRows.reduce((s, r) => s + r.cachedTokens, 0)) /
                turnRows.reduce((s, r) => s + r.promptTokens, 0)
              ).toFixed(1)
            )
          : 0,
      toolsSeen: tools.filter((t) => t.tool !== "(no_prior_tool)").map((t) => t.tool),
    },
    notes: [
      "Cache stats are per model turn, not per tool RPC.",
      "A tool is credited on the *following* model turn (when its result is in the prompt).",
      "Large tool results increase uncached suffix tokens and can lower hit rate.",
      "Stable system/tools schema still caches even after large tool outputs.",
    ],
  };
}

function mapToolsToTurns({ turns, toolTrace, events }) {
  const n = turns.length;
  const out = Array.from({ length: n }, () => []);

  // Prefer events: sequence of model turns interleaved with tool starts
  if (events?.length) {
    let turnIdx = -1;
    for (const e of events) {
      if (e.type === "model" && e.phase === "request") {
        turnIdx++;
      } else if (e.type === "tool" && e.phase === "start" && e.name) {
        if (turnIdx >= 0 && turnIdx < n && !out[turnIdx].includes(e.name)) {
          out[turnIdx].push(e.name);
        }
      }
    }
    if (out.some((x) => x.length)) return out;
  }

  // Fallback: put all tools on last turn that isn't the final pure-text turn
  // Heuristic: distribute toolTrace evenly across turns that likely had tools
  // (all but last if multiple turns, else first)
  if (!toolTrace?.length) return out;
  const names = toolTrace.map((t) => t.name).filter(Boolean);
  if (n === 0) {
    // No non-estimated usage turns — nothing to attribute
    return out;
  }
  if (n === 1) {
    out[0] = [...new Set(names)];
    return out;
  }
  // Assign tools to turns 0..n-2 mostly (final turn often answer-only)
  const targetTurns = Math.max(1, n - 1);
  names.forEach((name, i) => {
    const ti = Math.min(targetTurns - 1, i % targetTurns);
    if (!out[ti]) out[ti] = [];
    if (!out[ti].includes(name)) out[ti].push(name);
  });
  return out;
}

function summarizeToolResultSizes(toolTrace = []) {
  const map = new Map();
  for (const t of toolTrace || []) {
    const name = t.name || "unknown";
    const size = typeof t.result === "string" ? t.result.length : JSON.stringify(t.result || "").length;
    let a = map.get(name);
    if (!a) a = { tool: name, calls: 0, totalChars: 0, maxChars: 0 };
    a.calls += 1;
    a.totalChars += size;
    a.maxChars = Math.max(a.maxChars, size);
    map.set(name, a);
  }
  return [...map.values()]
    .map((a) => ({
      ...a,
      avgChars: Math.round(a.totalChars / Math.max(1, a.calls)),
    }))
    .sort((a, b) => b.totalChars - a.totalChars);
}

/**
 * Human-readable report.
 */
export function formatCacheByToolReport(analysis) {
  const lines = [];
  lines.push("Cache hit rates vs tools");
  lines.push("========================");
  lines.push(
    `Overall hit rate: ${analysis.summary.overallHitRatePct}%  (cached ${analysis.summary.totalCached} / prompt ${analysis.summary.totalPrompt})`
  );
  lines.push("");
  lines.push("Per turn:");
  for (const t of analysis.turns) {
    const tools = t.tools.length ? t.tools.join(", ") : "—";
    lines.push(
      `  turn ${t.turn}: hit ${t.hitRatePct}%  cached=${t.cachedTokens}/${t.promptTokens}  tools=[${tools}]`
    );
  }
  lines.push("");
  lines.push("By prior tool (cache on following model turn):");
  for (const r of analysis.byTool) {
    lines.push(
      `  ${r.tool}: hit ${r.hitRatePct}%  (avg ${r.avgHitRatePct}%)  turns=${r.turns}  uncached=${r.uncachedTokens}`
    );
  }
  if (analysis.toolResultSizes?.length) {
    lines.push("");
    lines.push("Tool result sizes (chars):");
    for (const r of analysis.toolResultSizes) {
      lines.push(`  ${r.tool}: calls=${r.calls} avg=${r.avgChars} max=${r.maxChars}`);
    }
  }
  return lines.join("\n");
}
