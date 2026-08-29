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
    // The operator-facing artefact dropped this: a fixed object literal with no
    // spread silently discarded the field passed to it, so a report of five
    // un-priced turns filed itself as "$0.00" with nothing saying nobody
    // measured. usedUsd without unpricedTurns is a number with no error bar.
    unpricedTurns: Number(partial.unpricedTurns ?? 0),
    turns: Number(partial.turns ?? 0),
    soakJobId: partial.soakJobId || null,
    canary: partial.canary || { fail: 0 },
    scorecard: partial.scorecard || { ok: null },
    at: new Date().toISOString(),
  };
}

/**
 * The report fields a CLI should write for a finished run.
 *
 * This lived inline in horizon-cli.mjs, inside the `--live --confirm-live`
 * branch — a branch no test can enter without an API key and a real provider
 * call, so every line of it was unreachable by the suite. It got them wrong:
 * it wrote the run's STARTING turn count (0 on a fresh run) over the truthful
 * report the runner had already written, and hardcoded a clean canary.
 *
 * The runner's own return is the authority; the checkpoint policy is only the
 * fallback for the paths that return before the runner writes anything
 * (soak_blocked, lease_denied, live_error). Extracted so the decision is
 * testable apart from the I/O it used to be buried in.
 *
 * @param {object} r result from runHorizonLive
 * @param {{ids?: string[], soakJobId?: string|null}} extra
 */
export function liveReportFromRun(r = {}, extra = {}) {
  return {
    mode: r.mode || "live",
    ok: r.ok !== false,
    ids: extra.ids,
    usedUsd: r.usedUsd ?? r.policy?.usedUsd ?? 0,
    unpricedTurns: r.unpricedTurns ?? r.liveReport?.unpricedTurns ?? 0,
    turns: r.liveReport?.turns ?? r.policy?.turns ?? 0,
    soakJobId: extra.soakJobId ?? null,
    canary: r.canary || r.liveReport?.canary || { fail: 0 },
    scorecard: r.scorecard || { ok: null },
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
  liveReportFromRun,
  writeLiveSoakReport,
  readLiveSoakReport,
  buildLiveSoakReport,
  renderLiveReportMetrics,
};
