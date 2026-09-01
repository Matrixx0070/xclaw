/**
 * Append-only eval run history under <configDir>/eval-history.jsonl
 *
 * eval-history.jsonl belongs to the config dir that owns the instance, not
 * to whoever's home dir the process happens to run under. Resolving it from
 * `os.homedir()` alone meant two instances on one host shared a single
 * history file, so instance B listed instance A's eval runs — and the suite
 * wrote into the operator's real `~/.xclaw/eval-history.jsonl`.
 *
 * Production writer (`appendEvalHistory(cfg)` at eval/runner.mjs:210) and
 * production readers (`listEvalHistory(cfg)` at gateway/dashboard,
 * gateway/routes/eval-queue, eval/scoreboard, eval/spend) already had cfg
 * in scope. `loadConfig()` stamps `paths.configDir` unconditionally
 * (config/load.mjs:187), so a cfg without one is never a real caller.
 * Such a path is `null` rather than guessing at the home dir. Same shape
 * as `preferencesPath`. Honour existing `XCLAW_CONFIG_DIR`.
 * `appendEvalHistory` still returns the in-memory line without persisting.
 * `listEvalHistory` returns `[]`. Do not `mkdir(null)`.
 */
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Honour `paths.configDir` then `XCLAW_CONFIG_DIR` then null.
 * No home fallback.
 */
export function evalHistoryPath(cfg = {}) {
  const base = cfg?.paths?.configDir || process.env.XCLAW_CONFIG_DIR;
  return base ? path.join(base, "eval-history.jsonl") : null;
}

function historyPath(cfg) {
  return evalHistoryPath(cfg);
}

/**
 * @param {object} cfg
 * @param {object} report runEvalSuite report
 */
export async function appendEvalHistory(cfg, report) {
  const line = {
    at: report.at || new Date().toISOString(),
    runId: report.runId,
    passRate: report.passRate,
    passed: report.passed,
    failed: report.failed,
    total: report.total,
    meanTurns: report.meanTurns,
    meanWallMs: report.meanWallMs,
    tokens: report.tokens || null,
    costUsd: report.cost?.usd ?? null,
    model: report.results?.[0]?.model || null,
  };
  const fp = historyPath(cfg);
  if (!fp) return line;
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.appendFile(fp, JSON.stringify(line) + "\n");
  return line;
}

/**
 * @param {object} cfg
 * @param {{ limit?: number }} [opts]
 */
export async function listEvalHistory(cfg, opts = {}) {
  const fp = historyPath(cfg);
  if (!fp) return [];
  let raw = "";
  try {
    raw = await fs.readFile(fp, "utf8");
  } catch {
    return [];
  }
  const limit = opts.limit ?? 30;
  const lines = raw.split("\n").filter(Boolean);
  const items = [];
  for (const l of lines.slice(-limit * 2)) {
    try {
      items.push(JSON.parse(l));
    } catch {
      /* skip */
    }
  }
  return items.slice(-limit).reverse();
}
