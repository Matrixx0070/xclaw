/**
 * Aggregate eval spend from history jsonl.
 */
import { listEvalHistory } from "./history.mjs";

/**
 * @param {object} cfg
 * @param {{ limit?: number }} [opts]
 */
export async function summarizeEvalSpend(cfg, opts = {}) {
  const limit = opts.limit ?? 100;
  const history = await listEvalHistory(cfg, { limit });
  let totalUsd = 0;
  let totalTokens = 0;
  let runs = 0;
  let passed = 0;
  for (const h of history) {
    runs += 1;
    if ((h.passRate || 0) >= 1) passed += 1;
    if (typeof h.costUsd === "number") totalUsd += h.costUsd;
    if (h.tokens?.total) totalTokens += h.tokens.total;
  }
  return {
    runs,
    fullyPassedRuns: passed,
    totalUsd: Math.round(totalUsd * 1e6) / 1e6,
    totalTokens,
    avgUsdPerRun: runs ? Math.round((totalUsd / runs) * 1e6) / 1e6 : 0,
    history: history.slice(0, 10),
  };
}
