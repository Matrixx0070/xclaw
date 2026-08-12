/**
 * Append-only eval run history under ~/.xclaw/eval-history.jsonl
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

function historyPath(cfg) {
  const base = cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw");
  return path.join(base, "eval-history.jsonl");
}

/**
 * @param {object} cfg
 * @param {object} report runEvalSuite report
 */
export async function appendEvalHistory(cfg, report) {
  const fp = historyPath(cfg);
  await fs.mkdir(path.dirname(fp), { recursive: true });
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
  await fs.appendFile(fp, JSON.stringify(line) + "\n");
  return line;
}

/**
 * @param {object} cfg
 * @param {{ limit?: number }} [opts]
 */
export async function listEvalHistory(cfg, opts = {}) {
  const fp = historyPath(cfg);
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
