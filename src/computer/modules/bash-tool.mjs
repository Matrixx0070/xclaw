/**
 * Native bash tool — clean module (Strategy C).
 * Spawn-time plan enforcement when systemRunPlan is present.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import {
  assertPlanAtSpawn,
  buildEnforcedBashSpawn,
  getSpawnEnforceMode,
} from "../../security/spawn-enforce.mjs";
import { wrapSpawnWithOsSandbox } from "../../security/os-sandbox.mjs";
import { buildToolEnv } from "../../security/env-policy.mjs";
import { isPidAlive } from "../../shared/pid-alive.mjs";


const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 120;

/** PIDs we started with background:true — stop-all must be able to kill them. */
const bgJobs = new Map();

export function registerBackgroundPid(pid, meta = {}) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  bgJobs.set(n, {
    logFile: meta.logFile || null,
    startedAt: meta.startedAt || Date.now(),
    kind: meta.kind || "bash",
  });
  return true;
}

export function listBackgroundBash() {
  for (const pid of [...bgJobs.keys()]) {
    if (!isPidAlive(pid)) bgJobs.delete(pid);
  }
  return [...bgJobs.entries()].map(([pid, meta]) => ({
    pid,
    logFile: meta.logFile,
    startedAt: meta.startedAt,
    kind: meta.kind || "bash",
    alive: true,
  }));
}

/**
 * SIGTERM the process group, then SIGKILL. Used by session kill-switch.
 */
export function killBackgroundBash() {
  const killed = [];
  const missed = [];
  for (const [pid] of [...bgJobs]) {
    let hit = false;
    try {
      process.kill(-pid, "SIGTERM");
      hit = true;
    } catch {
      try {
        process.kill(pid, "SIGTERM");
        hit = true;
      } catch {
        /* already gone */
      }
    }
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* */
      }
    }
    bgJobs.delete(pid);
    if (hit) killed.push(pid);
    else missed.push(pid);
  }
  return { ok: true, killed, missed };
}

const TERMINATE_GRACE_MS = 2_000;

/**
 * Kill a child (prefer process-group when detached so bash -c grandchildren die).
 * @param {import("node:child_process").ChildProcess} child
 * @param {NodeJS.Signals} sig
 */
function signalChild(child, sig = "SIGTERM") {
  if (!child?.pid) return false;
  try {
    process.kill(-child.pid, sig);
    return true;
  } catch {
    try {
      child.kill(sig);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Graceful terminate: SIGTERM, then SIGKILL after graceMs.
 * @returns {Promise<{ signal: string, forced: boolean }>}
 */
function terminateChild(child, { graceMs = TERMINATE_GRACE_MS, signal } = {}) {
  return new Promise((resolve) => {
    if (!child?.pid) {
      resolve({ signal: "none", forced: false });
      return;
    }
    let settled = false;
    const done = (info) => {
      if (settled) return;
      settled = true;
      resolve(info);
    };
    const onExit = () => done({ signal: "SIGTERM", forced: false });
    child.once("exit", onExit);
    signalChild(child, "SIGTERM");
    const t = setTimeout(() => {
      child.removeListener("exit", onExit);
      signalChild(child, "SIGKILL");
      done({ signal: "SIGKILL", forced: true });
    }, Math.max(0, graceMs));
    if (typeof t.unref === "function") t.unref();
    // If already dead, exit may have fired synchronously
    if (child.exitCode != null || child.signalCode) {
      clearTimeout(t);
      child.removeListener("exit", onExit);
      done({ signal: child.signalCode || "SIGTERM", forced: false });
    }
  });
}

/**
 * Normalize model/client timeout to seconds in [0, MAX_TIMEOUT_SECONDS].
 * Models often pass milliseconds (e.g. 30000, 120000); values > 1000 are
 * treated as ms. Avoids Zod/schema max-120 failures on the bundle path.
 * @param {unknown} raw
 * @returns {number} seconds
 */
export function normalizeBashTimeoutSeconds(raw) {
  if (raw == null || raw === "") return DEFAULT_TIMEOUT_SECONDS;
  let n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_TIMEOUT_SECONDS;
  // Heuristic: values above 1000 are almost certainly milliseconds
  if (n > 1000) n = n / 1000;
  if (n > MAX_TIMEOUT_SECONDS) n = MAX_TIMEOUT_SECONDS;
  return n;
}


/**
 * @param {object} input
 * @param {object} ctx
 * @param {string} [ctx.cwd]
 * @param {AbortSignal} [ctx.signal]
 * @param {object} [ctx.cfg]
 * @param {object} [ctx.systemRunPlan]
 */
export async function executeBash(input = {}, ctx = {}) {
  let command = String(input.command || "");
  if (!command.trim()) {
    return {
      ok: false,
      stdout: "",
      stderr: "command is required",
      exitCode: 1,
      code: "BASH_EMPTY_COMMAND",
    };
  }

  const plan =
    input.systemRunPlan ||
    input.plan ||
    ctx.systemRunPlan ||
    ctx.plan ||
    null;
  const mode = getSpawnEnforceMode(ctx.cfg || {});
  const check = assertPlanAtSpawn({
    plan,
    command,
    cwd: ctx.cwd || input.cwd,
    mode: plan ? mode : mode === "strict" ? "strict" : "off",
  });
  if (!check.ok) {
    return {
      ok: false,
      stdout: "",
      stderr: check.error || "spawn enforce denied",
      exitCode: 126,
      blocked: true,
      reason: check.reason || "spawn_enforce",
      code: "BASH_SPAWN_DENIED",
    };
  }
  command = check.command || command;

  const timeoutSec = normalizeBashTimeoutSeconds(input.timeout);
  const timeoutMs = Math.min(MAX_TIMEOUT_SECONDS * 1000, Math.max(0, Math.round(timeoutSec * 1000)));
  const cwd = check.cwd || ctx.cwd || process.cwd();
  const background = Boolean(input.background);

  // Secrets are not ambient: tool subprocesses get a policy-filtered env
  // (strip-secrets by default, allowlist in prod, inherit via security.bashEnv).
  const envPolicy = buildToolEnv(ctx.cfg || {});
  const spawnEnv = { ...envPolicy.env };
  // Non-interactive, no rc-file injection on any path
  spawnEnv.BASH_ENV = "";
  spawnEnv.ENV = "";

  const useEnforceSpawn = Boolean(check.enforced || plan);
  // Non-login shell (-c) everywhere; security.bashLogin=true restores -lc
  const loginShell = ctx.cfg?.security?.bashLogin === true;
  let spec = useEnforceSpawn
    ? buildEnforcedBashSpawn({ plan, command, cwd, env: spawnEnv })
    : {
        exe: "/bin/bash",
        argv: [loginShell ? "-lc" : "-c", command],
        cwd,
        env: spawnEnv,
      };

  const wrapped = wrapSpawnWithOsSandbox(spec, {
    cfg: ctx.cfg || {},
    workspace: ctx.workspace || ctx.cwd || cwd,
  });
  if (wrapped.deny) {
    return {
      ok: false,
      stdout: "",
      stderr: wrapped.error || "os sandbox denied",
      exitCode: 126,
      blocked: true,
      reason: wrapped.reason || "os_sandbox",
      code: "BASH_SANDBOX_DENIED",
    };
  }
  spec = wrapped;
  const osSandboxed = Boolean(wrapped.sandboxed);

  if (background) {
    const logDir = path.join(os.tmpdir(), "xclaw-bash-bg");
    await fs.mkdir(logDir, { recursive: true });
    const logFile = path.join(logDir, `${crypto.randomBytes(6).toString("hex")}.log`);
    const logFd = await fs.open(logFile, "w");
    const child = spawn(spec.exe, spec.argv, {
      cwd: spec.cwd,
      detached: true,
      stdio: ["ignore", logFd.fd, logFd.fd],
      env: spec.env,
    });
    const spawned = await new Promise((resolve) => {
      let done = false;
      const finish = (err) => {
        if (done) return;
        done = true;
        resolve({ err, pid: child.pid });
      };
      child.once("spawn", () => finish(null));
      child.once("error", (e) => finish(e));
    });
    child.unref();
    await logFd.close();
    if (spawned.err || !spawned.pid) {
      return {
        ok: false,
        pid: spawned.pid || null,
        logFile,
        stdout: "",
        stderr: String(spawned.err?.message || "background spawn failed"),
        timedOut: false,
        interrupted: false,
        spawnEnforced: Boolean(check.enforced),
        osSandboxed,
        netIsolated: Boolean(wrapped.netIsolated),
        envPolicy: envPolicy.mode,
        code: "BASH_BG_SPAWN_FAILED",
      };
    }
    // Let an immediate-exit command actually die before we call it started.
    await new Promise((r) => setTimeout(r, 25));
    if (!isPidAlive(spawned.pid)) {
      return {
        ok: false,
        pid: spawned.pid,
        logFile,
        stdout: "",
        stderr: `Background PID ${spawned.pid} exited immediately. Log: ${logFile}`,
        timedOut: false,
        interrupted: false,
        spawnEnforced: Boolean(check.enforced),
        osSandboxed,
        netIsolated: Boolean(wrapped.netIsolated),
        envPolicy: envPolicy.mode,
        code: "BASH_BG_DEAD",
      };
    }
    registerBackgroundPid(spawned.pid, { logFile, kind: "bash" });
    return {
      ok: true,
      pid: spawned.pid,
      logFile,
      stdout: "",
      stderr: `Started in background (PID ${spawned.pid}). Log: ${logFile}`,
      timedOut: false,
      interrupted: false,
      spawnEnforced: Boolean(check.enforced),
      osSandboxed,
      netIsolated: Boolean(wrapped.netIsolated),
      envPolicy: envPolicy.mode,
      code: "BASH_BG_STARTED",
    };
  }

  return new Promise((resolve) => {
    // detached: true → new process group so SIGTERM/SIGKILL reaches pipelines
    const child = spawn(spec.exe, spec.argv, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let interrupted = false;
    let stopSignal = null;
    let stopForced = false;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    const max = 2_000_000;
    let settled = false;

    child.stdout.on("data", (c) => {
      if (stdout.length >= max) {
        stdoutTruncated = true;
        return;
      }
      const s = c.toString();
      if (stdout.length + s.length > max) {
        stdout += s.slice(0, max - stdout.length);
        stdoutTruncated = true;
      } else {
        stdout += s;
      }
    });
    child.stderr.on("data", (c) => {
      if (stderr.length >= max) {
        stderrTruncated = true;
        return;
      }
      const s = c.toString();
      if (stderr.length + s.length > max) {
        stderr += s.slice(0, max - stderr.length);
        stderrTruncated = true;
      } else {
        stderr += s;
      }
    });

    let timer = null;
    let abortListener = null;
    const graceMs =
      Number(ctx.cfg?.security?.bashTerminateGraceMs) >= 0
        ? Number(ctx.cfg.security.bashTerminateGraceMs)
        : TERMINATE_GRACE_MS;

    const beginStop = async (reason) => {
      if (reason === "timeout") timedOut = true;
      if (reason === "abort") interrupted = true;
      const info = await terminateChild(child, { graceMs });
      stopSignal = info.signal;
      stopForced = info.forced;
    };

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        void beginStop("timeout");
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    }

    if (ctx.signal) {
      abortListener = () => {
        void beginStop("abort");
      };
      if (ctx.signal.aborted) abortListener();
      else ctx.signal.addEventListener("abort", abortListener, { once: true });
    }

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (ctx.signal && abortListener) {
        try {
          ctx.signal.removeEventListener("abort", abortListener);
        } catch {
          /* */
        }
      }
      resolve({
        ok: false,
        stdout,
        stderr: String(err?.message || err),
        exitCode: 1,
        timedOut: false,
        interrupted: false,
        outputTruncated: false,
        spawnEnforced: Boolean(check.enforced),
        osSandboxed,
        netIsolated: Boolean(wrapped.netIsolated),
        envPolicy: envPolicy.mode,
        code: "BASH_SPAWN_FAILED",
      });
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (ctx.signal && abortListener) {
        try {
          ctx.signal.removeEventListener("abort", abortListener);
        } catch {
          /* */
        }
      }
      const exitCode = code ?? (signal ? 128 : 1);
      const ok = !timedOut && !interrupted && code === 0;
      const outputTruncated = stdoutTruncated || stderrTruncated;
      if (outputTruncated) {
        const note =
          `\n[xclaw] BASH_OUTPUT_TRUNCATED: kept first ${max} chars` +
          (stdoutTruncated ? " (stdout)" : "") +
          (stderrTruncated ? " (stderr)" : "");
        if (stderr.length + note.length <= max + 200) stderr += note;
      }
      let errCode;
      if (timedOut) errCode = "BASH_TIMEOUT";
      else if (interrupted) errCode = "BASH_ABORTED";
      else if (code !== 0 && code != null) errCode = "BASH_EXIT_NONZERO";
      else if (code == null && signal) errCode = "BASH_SIGNAL";
      else if (outputTruncated) errCode = "BASH_OUTPUT_TRUNCATED";
      else errCode = "BASH_OK";
      resolve({
        ok,
        stdout,
        stderr,
        exitCode,
        timedOut,
        interrupted,
        signal: signal || stopSignal || null,
        stopForced,
        outputTruncated,
        truncated: { stdout: stdoutTruncated, stderr: stderrTruncated, maxChars: max },
        spawnEnforced: Boolean(check.enforced),
        osSandboxed,
        netIsolated: Boolean(wrapped.netIsolated),
        envPolicy: envPolicy.mode,
        code: errCode,
      });
    });
  });
}

export const BashTool = {
  name: "xclaw_bash",
  description:
    "Run a bash command in a fresh non-login shell at the session cwd. timeout is SECONDS (default 30, max 120) — never milliseconds. Long jobs: background=true → {pid, logFile, code:BASH_BG_STARTED}. Status example: kill -0 <pid> 2>/dev/null && echo ALIVE || echo DEAD; tail -n 40 <logFile>. Kill example: kill <pid> || kill -9 <pid>.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Bash command to run" },
      timeout: {
        type: "number",
        description:
          "Timeout in SECONDS only (1–120). Default 30. Do NOT pass 30000 or other millisecond values.",
        minimum: 0,
        maximum: 120,
      },
      background: { type: "boolean" },
      systemRunPlan: {
        type: "object",
        description:
          "Frozen run plan injected by the gateway approval path for spawn-time enforcement (not model-supplied)",
      },
    },
    required: ["command"],
  },
  execute: executeBash,
  call: async (args, ctx) => {
    const a = { ...(args || {}) };
    if ("timeout" in a) a.timeout = normalizeBashTimeoutSeconds(a.timeout);
    return executeBash(a, ctx);
  },
};

export const runBash = executeBash;

export default BashTool;
