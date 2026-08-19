/**
 * Durable live soak report under .xclaw-evidence/last-live-report.json
 */
import fsp from "node:fs/promises";
import path from "node:path";

const state = { live_report_total: 0 };

export function incLiveReport(n = 1) {
  state.live_report_total += n;
  return state.live_report_total;
}
export function getLiveReportTotal() {
  return state.live_report_total;
}
export function resetLiveReportMetrics() {
  state.live_report_total = 0;
}
export function renderLiveReportMetrics() {
  return `xclaw_horizon_live_report_total ${state.live_report_total}\n`;
}

export const DEFAULT_LIVE_IDS = [
  "a4-G10-plan-write-verify-fix",
  "a4-G11-tool-fail-recover",
  "a4-G13-canary-then-ground",
  "a4-G12-budget-near-limit",
  "a4-G14-multi-file-refactor",
];

export function liveReportPath(base) {
  return path.resolve(
    base || process.cwd(),
    ".xclaw-evidence",
    "last-live-report.json"
  );
}

export function buildLiveSoakReport(partial = {}) {
  const ids = Array.isArray(partial.ids) ? partial.ids : DEFAULT_LIVE_IDS;
  return {
    liveReport: true,
    mode: partial.mode || "live",
    ids,
    ok: partial.ok !== false,
    usedUsd: Number(partial.usedUsd ?? 0),
    turns: Number(partial.turns ?? 0),
    soakJobId: partial.soakJobId || null,
    canary: partial.canary || { fail: 0 },
    scorecard: partial.scorecard || { ok: null },
    at: new Date().toISOString(),
  };
}

export async function writeLiveSoakReport(partial = {}, opts = {}) {
  const report = buildLiveSoakReport(partial);
  const fp = liveReportPath(opts.base);
  await fsp.mkdir(path.dirname(fp), { recursive: true });
  await fsp.writeFile(fp, JSON.stringify(report, null, 2) + "\n", "utf8");
  incLiveReport();
  return { path: fp, report };
}

export async function readLiveSoakReport(opts = {}) {
  const fp = liveReportPath(opts.base);
  try {
    const j = JSON.parse(await fsp.readFile(fp, "utf8"));
    return { ok: true, path: fp, report: j };
  } catch (e) {
    if (e && e.code === "ENOENT") return { ok: false, path: fp, report: null };
    throw e;
  }
}

export default {
  DEFAULT_LIVE_IDS,
  writeLiveSoakReport,
  readLiveSoakReport,
  buildLiveSoakReport,
  renderLiveReportMetrics,
};
