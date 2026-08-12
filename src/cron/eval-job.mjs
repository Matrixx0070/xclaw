/**
 * Scheduled autonomy eval suite (overnight / periodic).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { addJob, getJob, listJobs } from "./scheduler.mjs";
import { ensureComputer } from "../computer/ensure.mjs";
import { runEvalSuite, formatEvalReport } from "../eval/runner.mjs";
import { getSharedAlerter } from "../alerting/alerts.mjs";
import { checkSpendThresholds } from "../eval/spend-alerts.mjs";
import { buildStatusReport } from "../gateway/report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function defaultLogPath() {
  return path.join(os.homedir(), ".xclaw", "eval-cron.log");
}

function appendLog(logPath, text) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, text + (text.endsWith("\n") ? "" : "\n"));
  } catch (err) {
    console.error("[xclaw:eval-cron] log write failed", err.message);
  }
}

/**
 * One eval pass. Writes baseline + log; alerts on regression/failure.
 */
export async function runScheduledEval(opts = {}) {
  const {
    cfg,
    tag = null,
    logPath = defaultLogPath(),
    writeBaseline = process.env.XCLAW_UPDATE_BASELINE === "1",
    notifyOnFail = true,
  } = opts;

  const stamp = new Date().toISOString();
  const key =
    cfg?.agent?.apiKey ||
    process.env.XCLAW_API_KEY ||
    process.env.XAI_API_KEY ||
    process.env.OPENAI_API_KEY;

  if (!key) {
    const msg = "skip eval cron: no API key";
    appendLog(logPath, `\n===== eval ${stamp} SKIP ${msg} =====\n`);
    return { ok: false, skipped: true, reason: msg };
  }

  const evalCfg = {
    ...cfg,
    security: { ...(cfg.security || {}), autoApprove: true },
  };

  await ensureComputer(evalCfg, { root: ROOT, attempts: 3 });

  const report = await runEvalSuite({
    cfg: evalCfg,
    tag: tag || undefined,
  });

  const body = formatEvalReport(report);
  appendLog(
    logPath,
    `\n===== eval ${stamp} passRate=${report.passRate} tokens=${report.tokens?.total ?? 0} =====\n${body}\n`
  );

  // Always record last cron result; only promote to main.json when explicitly requested
  try {
    const dir = path.join(ROOT, "eval", "baselines");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "last-cron.json"),
      JSON.stringify(report, null, 2) + "\n"
    );
  } catch (err) {
    appendLog(logPath, `last-cron write failed: ${err.message}`);
  }
  if (writeBaseline) {
    try {
      const fp = path.join(ROOT, "eval", "baselines", "main.json");
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, JSON.stringify(report, null, 2) + "\n");
      appendLog(logPath, "baseline main.json updated (XCLAW_UPDATE_BASELINE=1)");
    } catch (err) {
      appendLog(logPath, `baseline write failed: ${err.message}`);
    }
  }

  let notify = null;
  if (notifyOnFail && report.failed > 0) {
    const alerter = getSharedAlerter(cfg || {});
    notify = await alerter.send({
      title: "XClaw eval suite failures",
      body: `passRate=${(report.passRate * 100).toFixed(1)}% failed=${report.failed}/${report.total}`,
      severity: "error",
      key: `eval:fail:${stamp.slice(0, 10)}`,
    }).catch((e) => ({ ok: false, error: e.message }));
  }

  let spendCheck = null;
  try {
    spendCheck = await checkSpendThresholds(cfg, {});
  } catch {
    /* non-fatal */
  }

  try {
    const rep = await buildStatusReport(cfg);
    appendLog(logPath, "\n--- status report ---\n" + rep.markdown + "\n");
  } catch {
    /* non-fatal */
  }

  return { ok: report.failed === 0, report, notify, spendCheck, logPath };
}


/**
 * Register recurring eval cron job.
 * @param {object} opts
 * @param {object} opts.cfg
 * @param {number} [opts.everyMs] default 24h
 * @param {string} [opts.tag]
 */
export function ensureEvalCronJob(opts = {}) {
  const {
    cfg,
    everyMs = cfg?.eval?.cron?.everyMs || 24 * 60 * 60 * 1000,
    tag = cfg?.eval?.cron?.tag || null,
    name = "eval-suite",
  } = opts;

  const existing = listJobs().find((j) => j.name === name);
  if (existing) return existing;

  const job = addJob({
    name,
    everyMs,
    intervalMs: everyMs, // scheduler historically read intervalMs; without this defaulted to 60s
    enabled: true,
    _cfg: cfg,
    handler: async () => {
      console.log(`[xclaw:eval-cron] running suite…`);
      const out = await runScheduledEval({ cfg, tag });
      console.log(
        `[xclaw:eval-cron] done ok=${out.ok} passRate=${out.report?.passRate ?? "n/a"}`
      );
      return out;
    },
  });
  return job;
}

export function evalCronStatus() {
  const job = listJobs().find((j) => j.name === "eval-suite");
  return {
    registered: Boolean(job),
    job: job
      ? {
          id: job.id,
          everyMs: job.everyMs,
          nextRunAt: job.nextRunAt,
          lastRunAt: job.lastRunAt,
          enabled: job.enabled,
        }
      : null,
    logPath: defaultLogPath(),
  };
}
