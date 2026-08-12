/**
 * B3 — Scheduled live enforcement e2e (cadence).
 *
 * Runs scripts/live-enforcement-e2e.mjs, appends log under ~/.xclaw/,
 * optionally alerts on failure.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { addJob, listJobs, cancelJob } from "./scheduler.mjs";
import { deliverToChannel } from "./channel-deliver.mjs";
import { getSharedAlerter } from "../alerting/alerts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "../..");

function defaultLogPath() {
  return path.join(os.homedir(), ".xclaw", "live-e2e-cron.log");
}

function appendLog(logPath, text) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, text + (text.endsWith("\n") ? "" : "\n"));
  } catch (err) {
    console.error("[xclaw:live-e2e-cron] log write failed", err.message);
  }
}

function runLiveE2e(root, extraArgs = []) {
  return new Promise((resolve) => {
    const script = path.join(root, "scripts/live-enforcement-e2e.mjs");
    const child = spawn(
      process.execPath,
      [script, "--json", "--keep", ...extraArgs],
      {
        cwd: root,
        env: {
          ...process.env,
          XCLAW_ROOT: process.env.XCLAW_ROOT || root,
          XCLAW_COMMIT_GATES: process.env.XCLAW_COMMIT_GATES || "1",
          XCLAW_FABRIC_ENFORCE: process.env.XCLAW_FABRIC_ENFORCE || "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, out, err });
    });
  });
}

/**
 * One live-e2e pass + log + optional notify.
 */
export async function runLiveE2eCheck(opts = {}) {
  const root = opts.root || process.env.XCLAW_ROOT || PACKAGE_ROOT;
  const logPath = opts.logPath || defaultLogPath();
  const cfg = opts.cfg || {};
  const stamp = new Date().toISOString();

  const result = await runLiveE2e(root, opts.args || []);
  let report = null;
  try {
    report = JSON.parse(result.out);
  } catch {
    report = {
      ok: result.code === 0,
      exitCode: result.code,
      raw: (result.out + result.err).slice(-4000),
    };
  }

  // exit 1 = warnings only → treat as soft ok for cadence unless strict
  const strict = opts.strict || process.env.XCLAW_LIVE_E2E_STRICT === "1";
  const hardFail = strict ? result.code !== 0 : result.code === 2 || result.code > 2;
  const ok = !hardFail && (report.ok !== false || result.code === 1);

  const header = `\n===== live-e2e ${stamp} ok=${ok} exit=${result.code} =====\n`;
  const body =
    typeof report === "object"
      ? JSON.stringify(
          {
            ok,
            exitCode: result.code,
            fails: report.fails,
            warns: report.warns,
            results: (report.results || []).filter((r) => r.status !== "ok"),
          },
          null,
          2
        )
      : String(report);
  appendLog(logPath, header + body + "\n" + (result.err || "").slice(-1500));

  let notify = null;
  if (!ok && opts.notifyOnFail !== false) {
    try {
      const alerter = getSharedAlerter(cfg);
      notify = await alerter.alertLiveE2eFailure({
        ...(typeof report === "object" && report ? report : {}),
        exitCode: result.code,
        code: result.code,
        logPath,
        at: stamp,
        root,
      });
      if ((!notify || notify.skipped === "no_targets") && opts.delivery?.channel && opts.delivery?.to) {
        notify = await deliverToChannel(
          {
            mode: "announce",
            channel: opts.delivery.channel,
            to: opts.delivery.to,
            text: `XClaw live-e2e FAILED (${stamp}) exit=${result.code}`,
          },
          cfg
        );
      }
    } catch (e) {
      console.error("[xclaw:live-e2e-cron] notify failed", e.message);
    }
  }

  console.log(
    `[xclaw:live-e2e-cron] ok=${ok} exit=${result.code} log=${logPath}`
  );
  return { ok, code: result.code, report, logPath, notify };
}

/**
 * Register recurring live-e2e job on the in-process scheduler.
 * Default every 24h (nightly). Use everyMs for pre-release denser cadence.
 */
export function ensureLiveE2eCronJob(opts = {}) {
  const everyMs = Math.max(300_000, opts.everyMs ?? 86_400_000); // min 5m, default 24h
  const name = opts.name || "live-e2e";

  for (const j of listJobs()) {
    if (j.name === name || j.payload?.kind === "live-e2e") {
      cancelJob(j.id);
    }
  }

  const job = addJob({
    name,
    schedule: { kind: "every", everyMs },
    enabled: opts.enabled !== false,
    delivery: opts.delivery || null,
    sessionKey: opts.sessionKey || null,
    payload: { kind: "live-e2e" },
    cfg: opts.cfg,
    handler: async () => {
      await runLiveE2eCheck({
        cfg: opts.cfg,
        root: opts.root || process.env.XCLAW_ROOT || PACKAGE_ROOT,
        logPath: opts.logPath || defaultLogPath(),
        notifyOnFail: opts.notifyOnFail !== false,
        delivery: opts.delivery || null,
        strict: opts.strict === true,
      });
    },
  });

  return job;
}

export { defaultLogPath };
export default { runLiveE2eCheck, ensureLiveE2eCronJob, defaultLogPath };
