/**
 * B3 — Scheduled live enforcement e2e (cadence).
 *
 * Runs scripts/live-enforcement-e2e.mjs, appends log under ~/.xclaw/,
 * optionally alerts on failure.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { addJob, listJobs, cancelJob } from "./scheduler.mjs";
import { deliverToChannel } from "./channel-deliver.mjs";
import { getSharedAlerter } from "../alerting/alerts.mjs";
import { cronLogPath } from "./logs.mjs";
import {
  gradeLiveE2e,
  CODE_SIGNAL,
  CODE_SPAWN_ERROR,
  CODE_TIMEOUT,
} from "./live-e2e-grade.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "../..");

function defaultLogPath(cfg) {
  return cronLogPath(cfg, "live-e2e-cron.log");
}

function appendLog(logPath, text) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, text + (text.endsWith("\n") ? "" : "\n"));
  } catch (err) {
    console.error("[xclaw:live-e2e-cron] log write failed", err.message);
  }
}

/** Default wall-clock budget for one live-e2e pass. */
const DEFAULT_TIMEOUT_MS = 600_000;

/**
 * Grace between SIGTERM and SIGKILL, matching TERMINATE_GRACE_MS in
 * src/computer/modules/bash-tool.mjs.
 */
const DEFAULT_GRACE_MS = 2_000;

/**
 * Resolve the wall-clock budget for one run.
 *
 * Exported because it is the whole fail-open in one expression and is
 * otherwise only reachable through a subprocess. `??` catches null/undefined
 * but not NaN -- and NaN is exactly what `Number(cfgValue)` yields for junk.
 * A NaN budget fails the `timeoutMs > 0` test at the call site, leaving the
 * child unbounded: the very defect this slice closes, reinstated by a typo in
 * xclaw.json. 0 still disables the timer, deliberately, as an escape hatch.
 *
 * @param {{timeoutMs?: unknown, graceMs?: unknown}} [opts]
 * @returns {{timeoutMs: number, graceMs: number}}
 */
export function resolveRunBudget(opts = {}) {
  return {
    timeoutMs: Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS,
    graceMs: Number.isFinite(opts.graceMs) ? opts.graceMs : DEFAULT_GRACE_MS,
  };
}

/**
 * Signal a child's whole process group, falling back to the child alone.
 *
 * Group kill, not child kill: the check spawns its own helpers, and a kill
 * aimed only at the direct child leaves them running with the pipes open.
 *
 * What it deliberately does NOT reach: the computer server. That one is
 * spawned `detached` with unref() (src/computer/manager.mjs:262-268), so it
 * calls setsid() and leads its own process group -- measured, a group kill
 * aimed at this child cannot touch it. That is intended rather than a gap:
 * the run below passes --keep, so the server is meant to outlive even a
 * successful pass. Do not restate this as "the timeout kills the server".
 */
function killTree(child, sig) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, sig);
  } catch {
    try {
      child.kill(sig);
    } catch {
      /* already gone */
    }
  }
}

/**
 * Run one live-enforcement-e2e pass.
 *
 * Three failure modes are handled here rather than left to crash or hang:
 *
 * - spawn never starts (a moved XCLAW_ROOT makes cwd nonexistent, an
 *   unrunnable interpreter). Node emits 'error'; with no listener that is an
 *   unhandled 'error' event, which kills the gateway that scheduled the job.
 *   Measured before this listener existed: `Error: spawn /usr/bin/node ENOENT`
 *   with the promise never settling.
 * - the child hangs. There was no timeout at any layer: not here, not in the
 *   scheduler, not in the documented systemd unit (Type=oneshot with no
 *   TimeoutStartSec). Measured: a fixture calling only setInterval was still
 *   running when the harness gave up.
 * - the child dies on a signal (see live-e2e-grade.mjs).
 *
 * Every substituted code is >= 3 so it lands outside the producer's 0/1/2 and
 * grades as a hard failure in both strict and non-strict mode.
 */
function runLiveE2e(root, extraArgs = [], opts = {}) {
  const exe = opts.exe || process.execPath;
  const { timeoutMs, graceMs } = resolveRunBudget(opts);
  return new Promise((resolve) => {
    const script = path.join(root, "scripts/live-enforcement-e2e.mjs");
    let out = "";
    let err = "";
    let settled = false;
    let timedOut = false;
    let timer = null;
    let graceTimer = null;

    const settle = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      resolve(value);
    };

    let child;
    try {
      child = spawn(exe, [script, "--json", "--keep", ...extraArgs], {
        cwd: root,
        // Own process group, so the timeout below can reach grandchildren.
        detached: true,
        env: {
          ...process.env,
          XCLAW_ROOT: process.env.XCLAW_ROOT || root,
          XCLAW_COMMIT_GATES: process.env.XCLAW_COMMIT_GATES || "1",
          XCLAW_FABRIC_ENFORCE: process.env.XCLAW_FABRIC_ENFORCE || "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      settle({ code: CODE_SPAWN_ERROR, signal: null, out, err: String(e?.message || e) });
      return;
    }

    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      err += d;
    });

    child.on("error", (e) => {
      settle({ code: CODE_SPAWN_ERROR, signal: null, out, err: err + String(e?.message || e) });
    });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killTree(child, "SIGTERM");
        graceTimer = setTimeout(() => {
          killTree(child, "SIGKILL");
          // Resolve here rather than waiting for 'close': that event fires only
          // once every stdio pipe reaches EOF, and a grandchild holding one
          // open can keep it from ever arriving.
          settle({ code: CODE_TIMEOUT, signal: "SIGKILL", out, err: err + "\n(timeout)" });
        }, graceMs);
      }, timeoutMs);
    }

    // A child that dies on a signal reports code === null. Coalescing that to
    // 1 made an OOM kill indistinguishable from a warnings-only pass; see
    // live-e2e-grade.mjs. CODE_SIGNAL is outside the producer's 0/1/2 range.
    child.on("close", (code, signal) => {
      if (timedOut) {
        settle({ code: CODE_TIMEOUT, signal: signal || null, out, err: err + "\n(timeout)" });
        return;
      }
      settle({ code: code == null ? CODE_SIGNAL : code, signal: signal || null, out, err });
    });
  });
}

/**
 * One live-e2e pass + log + optional notify.
 */
export async function runLiveE2eCheck(opts = {}) {
  const root = opts.root || process.env.XCLAW_ROOT || PACKAGE_ROOT;
  const logPath = opts.logPath || defaultLogPath(opts.cfg);
  const cfg = opts.cfg || {};
  const stamp = new Date().toISOString();

  const result = await runLiveE2e(root, opts.args || [], {
    exe: opts.exe,
    timeoutMs: opts.timeoutMs,
    graceMs: opts.graceMs,
  });
  let report = null;
  let parsed = false;
  try {
    const j = JSON.parse(result.out);
    // JSON.parse("null") yields null, and JSON.parse("3") a number; either
    // would make the .ok read below throw or lie.
    if (j && typeof j === "object") {
      report = j;
      parsed = true;
    }
  } catch {
    /* handled by the fallback below */
  }
  if (!parsed) {
    report = {
      ok: result.code === 0,
      exitCode: result.code,
      raw: (result.out + result.err).slice(-4000),
    };
  }

  const strict = opts.strict || process.env.XCLAW_LIVE_E2E_STRICT === "1";
  const { ok, reason } = gradeLiveE2e({ code: result.code, reportOk: report.ok, parsed, strict });

  const sig = result.signal ? ` signal=${result.signal}` : "";
  const header = `\n===== live-e2e ${stamp} ok=${ok} exit=${result.code}${sig} reason=${reason} =====\n`;
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
    `[xclaw:live-e2e-cron] ok=${ok} exit=${result.code} reason=${reason} log=${logPath}`
  );
  return { ok, code: result.code, reason, report, logPath, notify };
}

/**
 * Map the `liveE2e.cron` block of xclaw.json onto the options this module
 * takes, so the mapping itself is testable.
 *
 * It was inline in bin/xclaw.mjs, where it cannot be exercised: the switch case
 * dynamically imports its own dependencies and calls loadConfig() itself. That
 * is how `enabled` came to be documented in docs/PROD_PRESET.md and read by
 * nobody — `ensureLiveE2eCronJob` honours `opts.enabled`, but the only caller
 * never passed it, so an operator who wrote `"enabled": false` still got the
 * job. Both sibling cron jobs wire theirs (src/gateway/index.mjs).
 *
 * The caller spreads the whole return value rather than copying keys across,
 * so adding one here cannot be silently dropped in transit.
 *
 * @param {object} cfg loaded config (already through loadConfig)
 * @param {{everyMsArg?: unknown}} [opts] CLI positional override for everyMs
 * @returns {{everyMs: number, delivery: object|null, strict: boolean,
 *            enabled: boolean, notifyOnFail: boolean, timeoutMs: number,
 *            graceMs: number}}
 */
export function liveE2eCronOptionsFromConfig(cfg = {}, opts = {}) {
  const c = cfg?.liveE2e?.cron || {};
  return {
    everyMs: Number(opts.everyMsArg) || c.everyMs || 86_400_000,
    delivery: c.delivery || null,
    strict: c.strict === true,
    enabled: c.enabled !== false,
    notifyOnFail: c.notifyOnFail !== false,
    timeoutMs: Number(c.timeoutMs) > 0 ? Number(c.timeoutMs) : DEFAULT_TIMEOUT_MS,
    graceMs: Number(c.graceMs) > 0 ? Number(c.graceMs) : DEFAULT_GRACE_MS,
  };
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
        logPath: opts.logPath || defaultLogPath(opts.cfg),
        notifyOnFail: opts.notifyOnFail !== false,
        delivery: opts.delivery || null,
        strict: opts.strict === true,
        timeoutMs: opts.timeoutMs,
        graceMs: opts.graceMs,
      });
    },
  });

  return job;
}

export { defaultLogPath };
export default {
  runLiveE2eCheck,
  ensureLiveE2eCronJob,
  liveE2eCronOptionsFromConfig,
  resolveRunBudget,
  defaultLogPath,
};
