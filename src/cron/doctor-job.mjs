/**
 * Scheduled doctor checks via XClaw cron.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildDoctorReport, formatDoctorReport } from "../gateway/doctor.mjs";
import { addJob, getJob, listJobs, cancelJob } from "./scheduler.mjs";
import { deliverToChannel } from "./channel-deliver.mjs";
import { getSharedAlerter } from "../alerting/alerts.mjs";

function defaultLogPath() {
  return path.join(os.homedir(), ".xclaw", "doctor-cron.log");
}

function appendLog(logPath, text) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, text + (text.endsWith("\n") ? "" : "\n"));
  } catch (err) {
    console.error("[xclaw:doctor-cron] log write failed", err.message);
  }
}

/**
 * Run one doctor pass and optionally notify / log.
 */
export async function runDoctorCheck(opts = {}) {
  const {
    cfg,
    channelManager,
    isComputerRunning,
    logPath = defaultLogPath(),
    notifyOnFail = true,
    notifyOnOk = false,
    delivery = null, // { channel, to } for alert
  } = opts;

  const report = await buildDoctorReport({
    cfg: cfg || {},
    channelManager,
    isComputerRunning: isComputerRunning || (async () => false),
  });

  const stamp = new Date().toISOString();
  const header = `\n===== doctor ${stamp} ok=${report.ok} =====\n`;
  const body = formatDoctorReport(report, { color: false });
  appendLog(logPath, header + body);

  let notify = null;
  const shouldNotify =
    (notifyOnFail && !report.ok) || (notifyOnOk && report.ok);

  if (shouldNotify) {
    const alerter = getSharedAlerter(cfg || {});
    if (!report.ok) {
      notify = await alerter.alertDoctorFailure(report);
    } else if (notifyOnOk) {
      notify = await alerter.send({
        key: "doctor:ok",
        severity: "info",
        title: "Doctor check OK",
        body: stamp,
      });
    }
    // legacy direct delivery if alerter has no targets but delivery passed
    if ((!notify || notify.skipped === "no_targets") && delivery?.channel && delivery?.to) {
      const text = report.ok
        ? `XClaw doctor OK (${stamp})`
        : `XClaw doctor FAILED: ${(report.failed || []).join(", ")}\n${body.slice(0, 3500)}`;
      notify = await deliverToChannel(
        { mode: "announce", channel: delivery.channel, to: delivery.to, text },
        cfg || {}
      );
    }
  }

  console.log(
    `[xclaw:doctor-cron] ok=${report.ok} failed=${(report.failed || []).join(",") || "—"} log=${logPath}`
  );

  return { report, logPath, notify };
}

/**
 * Ensure a recurring doctor cron job exists.
 * @param {object} opts
 * @param {object} opts.cfg
 * @param {number} [opts.everyMs=3600000] default 1h
 * @param {object} [opts.delivery] channel notify target
 * @param {boolean} [opts.notifyOnFail=true]
 * @param {boolean} [opts.enabled=true]
 * @param {function} opts.isComputerRunning
 * @param {object} opts.channelManager
 */

/**
 * B4 — Run CLI doctor a.* enforcement slice and alert on errors.
 */
export async function runEnforcementDoctorSlice(opts = {}) {
  const cfg = opts.cfg || {};
  try {
    const { runDoctor } = await import("../cli/doctor.mjs");
    const prevRoot = process.env.XCLAW_ROOT;
    if (opts.root) process.env.XCLAW_ROOT = opts.root;
    const full = await runDoctor({ json: true, quiet: true });
    // runDoctor prints JSON when json:true — it returns report
    const report = full;
    const aFails = (report.checks || []).filter(
      (c) =>
        (String(c.id || "").startsWith("a.") || String(c.id || "").startsWith("h0.")) &&
        c.status === "error"
    );
    if (prevRoot === undefined) delete process.env.XCLAW_ROOT;
    else process.env.XCLAW_ROOT = prevRoot;

    if (aFails.length && opts.notifyOnFail !== false) {
      const alerter = getSharedAlerter(cfg);
      await alerter.alertEnforcementFailure({
        failedIds: aFails.map((c) => c.id),
        message: aFails.map((c) => `${c.id}: ${c.message}`).join("\n"),
        at: report.at || new Date().toISOString(),
      });
    }
    return {
      ok: aFails.length === 0,
      failed: aFails.map((c) => c.id),
      checks: aFails,
    };
  } catch (e) {
    console.error("[xclaw:doctor-cron] enforcement slice failed", e.message);
    return { ok: false, error: e.message };
  }
}

export function ensureDoctorCronJob(opts = {}) {
  const everyMs = Math.max(60_000, opts.everyMs ?? 3_600_000);
  const name = opts.name || "doctor";

  // remove existing doctor jobs with same name
  for (const j of listJobs()) {
    if (j.name === name || j.payload?.kind === "doctor") {
      cancelJob(j.id);
    }
  }

  const job = addJob({
    name,
    schedule: { kind: "every", everyMs },
    enabled: opts.enabled !== false,
    delivery: opts.delivery || null,
    sessionKey: opts.sessionKey || null,
    payload: { kind: "doctor" },
    cfg: opts.cfg,
    handler: async () => {
      await runDoctorCheck({
        cfg: opts.cfg,
        channelManager: opts.channelManager,
        isComputerRunning: opts.isComputerRunning,
        logPath: opts.logPath || defaultLogPath(),
        notifyOnFail: opts.notifyOnFail !== false,
        notifyOnOk: opts.notifyOnOk === true,
        delivery: opts.delivery || null,
      });
      // B4: Phase A enforcement (a.* / h0.*) via CLI doctor
      if (opts.enforcement !== false) {
        await runEnforcementDoctorSlice({
          cfg: opts.cfg,
          root: opts.root || process.env.XCLAW_ROOT,
          notifyOnFail: opts.notifyOnFail !== false,
        });
      }
    },
  });

  return job;
}

export { defaultLogPath };
