/**
 * xclaw update — git checkout (fetch + rebase) or global package install.
 *
 * Skips a dirty working tree. Refuses restart while the eval suite is running
 * (log text, not in-process job list). Does not publish. Does not duplicate
 * the self-deploy intent consumer. Default timeout 600000 ms.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { inspectGitWorktree } from "../agent/git-status.mjs";

export const DEFAULT_TIMEOUT_MS = 600_000;
export const PACKAGE_NAME = "xclaw";

export function parseUpdateArgs(args = []) {
  const has = (name) => args.includes(name);
  const opt = (name, fallback = null) => {
    const i = args.indexOf(name);
    if (i < 0) return fallback;
    const v = args[i + 1];
    if (v == null || String(v).startsWith("-")) return fallback;
    return v;
  };
  const raw = opt("--timeout", String(DEFAULT_TIMEOUT_MS));
  const timeoutMs = Number(raw);
  return {
    json: has("--json"),
    dryRun: has("--dry-run"),
    noRestart: has("--no-restart"),
    yes: has("--yes") || has("-y"),
    help: has("--help") || has("-h"),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

export function updateHelpText() {
  return `Usage:
  xclaw update [--json] [--dry-run] [--no-restart] [--yes] [--timeout <ms>]

Update a git checkout (fetch + rebase) or a global package install of xclaw.
Skips a dirty working tree. Refuses to restart while the eval suite is running.
Default timeout is 600000 ms (10 minutes).`;
}

export function commandOnPath(name, spawnSyncImpl = spawnSync) {
  if (!/^[a-z0-9]+$/i.test(String(name || ""))) return false;
  const r = spawnSyncImpl("sh", ["-c", `command -v ${name}`], { encoding: "utf8" });
  return r.status === 0 && String(r.stdout || "").trim().length > 0;
}

export function detectInstallKind(cwd = process.cwd(), opts = {}) {
  const dir = path.resolve(cwd || process.cwd());
  const gitMarker = path.join(dir, ".git");
  if (fs.existsSync(gitMarker)) {
    return { kind: "git", cwd: dir, packageName: PACKAGE_NAME };
  }
  const which = opts.which || ((n) => commandOnPath(n, opts.spawnSyncImpl));
  for (const manager of ["npm", "pnpm", "bun"]) {
    if (which(manager)) {
      return { kind: "npm", manager, cwd: dir, packageName: PACKAGE_NAME };
    }
  }
  return { kind: "npm", manager: "npm", cwd: dir, packageName: PACKAGE_NAME };
}

export function isDirtyTree(cwd = process.cwd()) {
  const st = inspectGitWorktree(cwd);
  return Boolean(st.isRepo && st.dirty);
}

/**
 * True when the newest "running suite" marker is later than the newest
 * completion / SKIP stamp. Probe log text, not in-process listJobs().
 */
export function evalSuiteInFlight(logText) {
  const text = String(logText || "");
  const runningIdx = Math.max(
    text.lastIndexOf("[xclaw:eval-cron] running suite"),
    text.lastIndexOf("running suite")
  );
  if (runningIdx < 0) return false;
  const doneIdx = Math.max(
    text.lastIndexOf("[xclaw:eval-cron] done"),
    text.lastIndexOf("===== eval ")
  );
  return runningIdx > doneIdx;
}

export function defaultEvalLogPaths(cfg = {}) {
  const dir = cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw");
  return [path.join(dir, "logs", "gateway.log"), path.join(dir, "eval-cron.log")];
}

export function readEvalLogs(paths = []) {
  let text = "";
  for (const p of paths) {
    try {
      text += fs.readFileSync(p, "utf8") + "\n";
    } catch {
      /* missing log is not in-flight */
    }
  }
  return text;
}

function runCmd(spawnImpl, cmd, cmdArgs, opts) {
  return spawnImpl(cmd, cmdArgs, {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs,
    encoding: "utf8",
  });
}

function defaultSpawn(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, {
    cwd: opts.cwd,
    encoding: opts.encoding || "utf8",
    timeout: opts.timeoutMs || DEFAULT_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
    env: process.env,
  });
  return {
    status: r.status == null ? 1 : r.status,
    stdout: String(r.stdout || ""),
    stderr: String(r.stderr || ""),
    error: r.error ? r.error.message : null,
  };
}

function isUnpublished(view) {
  const blob = `${view?.stdout || ""}\n${view?.stderr || ""}`.toLowerCase();
  if (!view || view.status !== 0) return true;
  if (!String(view.stdout || "").trim()) return true;
  if (blob.includes("e404") || blob.includes("404") || blob.includes("not found")) return true;
  return false;
}

function globalInstallArgs(manager) {
  if (manager === "pnpm" || manager === "bun") return ["add", "-g", `${PACKAGE_NAME}@latest`];
  return ["install", "-g", `${PACKAGE_NAME}@latest`];
}

function defaultRestart() {
  return { restarted: false, skipped: "no_supervisor" };
}

/**
 * @param {object} [opts]
 * @param {string} [opts.cwd]
 * @param {string[]} [opts.args]
 * @param {object} [opts.cfg]
 * @param {Function} [opts.spawnImpl]
 * @param {Function} [opts.whichImpl]
 * @param {Function} [opts.readLogs]
 * @param {Function} [opts.runDoctorImpl]
 * @param {Function} [opts.restartImpl]
 */
export async function runUpdate(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const parsed = parseUpdateArgs(opts.args || []);
  const spawnImpl = opts.spawnImpl || defaultSpawn;
  const result = {
    ok: true,
    packageName: PACKAGE_NAME,
    dryRun: parsed.dryRun,
    noRestart: parsed.noRestart,
    yes: parsed.yes,
    timeoutMs: parsed.timeoutMs,
    kind: null,
    manager: null,
    plan: [],
    skipped: null,
    restarted: false,
    restartSkipped: null,
    evalSuiteInFlight: false,
    doctor: null,
    error: null,
  };

  if (parsed.help) {
    result.help = true;
    result.helpText = updateHelpText();
    return result;
  }

  const kind = detectInstallKind(cwd, { which: opts.whichImpl, spawnSyncImpl: opts.spawnSyncImpl });
  result.kind = kind.kind;
  result.manager = kind.manager || null;

  if (kind.kind === "git") {
    result.plan = ["git fetch", "git rebase"];
    if (fs.existsSync(path.join(cwd, "package-lock.json"))) {
      result.plan.push("npm install --no-fund --no-audit");
    }
    if (isDirtyTree(cwd)) {
      result.ok = false;
      result.skipped = "dirty";
      result.error = "working tree is dirty — commit or stash before update";
      return result;
    }
    if (parsed.dryRun) return result;
    const fetch = runCmd(spawnImpl, "git", ["fetch"], { cwd, timeoutMs: parsed.timeoutMs });
    if (fetch.status !== 0) {
      result.ok = false;
      result.error = String(fetch.stderr || fetch.stdout || fetch.error || "git fetch failed").slice(0, 400);
      return result;
    }
    const rebase = runCmd(spawnImpl, "git", ["rebase"], { cwd, timeoutMs: parsed.timeoutMs });
    if (rebase.status !== 0) {
      result.ok = false;
      result.error = String(rebase.stderr || rebase.stdout || rebase.error || "git rebase failed").slice(0, 400);
      return result;
    }
    if (result.plan.includes("npm install --no-fund --no-audit")) {
      const inst = runCmd(spawnImpl, "npm", ["install", "--no-fund", "--no-audit"], {
        cwd,
        timeoutMs: parsed.timeoutMs,
      });
      if (inst.status !== 0) {
        result.ok = false;
        result.error = String(inst.stderr || inst.stdout || inst.error || "npm install failed").slice(0, 400);
        return result;
      }
    }
  } else {
    const manager = kind.manager || "npm";
    result.plan = [`${manager} view ${PACKAGE_NAME} version`, `${manager} ${globalInstallArgs(manager).join(" ")}`];
    if (parsed.dryRun) return result;
    const view = runCmd(spawnImpl, manager, ["view", PACKAGE_NAME, "version"], {
      cwd,
      timeoutMs: parsed.timeoutMs,
    });
    if (isUnpublished(view)) {
      result.ok = false;
      result.skipped = "unpublished";
      result.error = `package ${PACKAGE_NAME} is not on the registry`;
      return result;
    }
    const inst = runCmd(spawnImpl, manager, globalInstallArgs(manager), {
      cwd,
      timeoutMs: parsed.timeoutMs,
    });
    if (inst.status !== 0) {
      result.ok = false;
      result.error = String(inst.stderr || inst.stdout || inst.error || "global install failed").slice(0, 400);
      return result;
    }
  }

  const logText = opts.readLogs
    ? await opts.readLogs()
    : readEvalLogs(defaultEvalLogPaths(opts.cfg || {}));
  const inFlight = evalSuiteInFlight(logText);
  result.evalSuiteInFlight = inFlight;

  const wouldRestart = !parsed.noRestart && !parsed.dryRun && !inFlight;
  if (parsed.noRestart) {
    result.restartSkipped = "no_restart";
  } else if (inFlight) {
    result.restartSkipped = "eval_suite_in_flight";
  } else if (wouldRestart) {
    const restartImpl = opts.restartImpl || defaultRestart;
    const rs = await restartImpl({ cwd, cfg: opts.cfg });
    result.restarted = Boolean(rs?.restarted);
    result.restartSkipped = rs?.skipped || (result.restarted ? null : "no_supervisor");
  }

  if (result.ok && !parsed.dryRun) {
    if (opts.runDoctorImpl) {
      result.doctor = await opts.runDoctorImpl({ json: parsed.json, quiet: parsed.json });
    } else {
      const { runDoctor } = await import("./doctor.mjs");
      result.doctor = await runDoctor({ json: parsed.json, quiet: parsed.json });
    }
  }
  return result;
}

export async function updateMain(args = [], opts = {}) {
  const parsed = parseUpdateArgs(args);
  if (parsed.help) {
    process.stdout.write(updateHelpText() + "\n");
    return 0;
  }
  const out = await runUpdate({ ...opts, args });
  if (parsed.json) {
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  } else if (!out.ok) {
    process.stderr.write(`[xclaw] update failed: ${out.error || out.skipped || "error"}\n`);
    if (out.skipped === "dirty") {
      process.stderr.write("[xclaw] working tree is dirty — commit or stash, then retry\n");
    }
    if (out.skipped === "unpublished") {
      process.stderr.write("[xclaw] install from git until the package is published\n");
    }
  } else {
    const bits = [`kind=${out.kind}`];
    if (out.dryRun) bits.push("dry-run");
    if (out.restartSkipped) bits.push(`restart=${out.restartSkipped}`);
    else if (out.restarted) bits.push("restarted");
    process.stdout.write(`[xclaw] update ok ${bits.join(" ")}\n`);
  }
  return out.ok ? 0 : 1;
}
