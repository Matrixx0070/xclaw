/**
 * Check eval spend against thresholds; optional alert.
 */
import { summarizeEvalSpend } from "./spend.mjs";
import { getSharedAlerter } from "../alerting/alerts.mjs";

/**
 * @param {object} cfg
 * @param {{ limit?: number }} [opts]
 */
export async function checkSpendThresholds(cfg, opts = {}) {
  const maxUsd = cfg.eval?.spend?.maxUsdPerWindow;
  const maxRuns = cfg.eval?.spend?.maxRunsPerWindow;
  const limit = opts.limit ?? cfg.eval?.spend?.windowRuns ?? 50;
  const summary = await summarizeEvalSpend(cfg, { limit });
  const breaches = [];
  if (maxUsd != null && summary.totalUsd > maxUsd) {
    breaches.push(`totalUsd ${summary.totalUsd} > max ${maxUsd}`);
  }
  if (maxRuns != null && summary.runs > maxRuns) {
    breaches.push(`runs ${summary.runs} > max ${maxRuns}`);
  }
  let notify = null;
  if (breaches.length && cfg.eval?.spend?.alert !== false) {
    const alerter = getSharedAlerter(cfg);
    notify = await alerter
      .send({
        title: "XClaw eval spend threshold",
        body: breaches.join("; "),
        severity: "warning",
        key: `eval:spend:${new Date().toISOString().slice(0, 10)}`,
      })
      .catch((e) => ({ ok: false, error: e.message }));
  }
  return { ok: breaches.length === 0, breaches, summary, notify };
}
