/**
 * Per-tool token usage and cache hit rates.
 */
const byTool = new Map();

export function recordToolTokens(name, { prompt = 0, completion = 0, cached = 0 } = {}) {
  const key = String(name || "unknown");
  const cur = byTool.get(key) || { prompt: 0, completion: 0, cached: 0, calls: 0 };
  cur.prompt += Number(prompt) || 0;
  cur.completion += Number(completion) || 0;
  cur.cached += Number(cached) || 0;
  cur.calls += 1;
  byTool.set(key, cur);
  return cur;
}

export function toolCacheHitRate(name) {
  const cur = byTool.get(String(name || ""));
  if (!cur || cur.prompt <= 0) return 0;
  return cur.cached / cur.prompt;
}

export function snapshotTokenCache() {
  const out = {};
  for (const [k, v] of byTool) {
    out[k] = {
      ...v,
      hitRate: v.prompt > 0 ? v.cached / v.prompt : 0,
    };
  }
  return out;
}

export function resetTokenCache() {
  byTool.clear();
}

export function renderTokenCacheMetrics() {
  const snap = snapshotTokenCache();
  let s = "";
  for (const [tool, v] of Object.entries(snap)) {
    s += `xclaw_tool_tokens_prompt{tool="${tool}"} ${v.prompt}\n`;
    s += `xclaw_tool_tokens_cached{tool="${tool}"} ${v.cached}\n`;
    s += `xclaw_tool_cache_hit_rate{tool="${tool}"} ${v.hitRate}\n`;
  }
  return s;
}

export default {
  recordToolTokens,
  toolCacheHitRate,
  snapshotTokenCache,
  resetTokenCache,
};
