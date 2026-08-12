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

const DEFAULT_TIMEOUT_SECONDS = 30;

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
    return { ok: false, stdout: "", stderr: "command is required", exitCode: 1 };
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
    };
  }
  command = check.command || command;

  const timeoutSec = Number(input.timeout ?? DEFAULT_TIMEOUT_SECONDS);
  const timeoutMs = Math.min(120_000, Math.max(0, timeoutSec * 1000));
  const cwd = check.cwd || ctx.cwd || process.cwd();
  const background = Boolean(input.background);

  const useEnforceSpawn = Boolean(check.enforced || plan);
  let spec = useEnforceSpawn
    ? buildEnforcedBashSpawn({ plan, command, cwd, env: process.env })
    : {
        exe: "/bin/bash",
        argv: ["-lc", command],
        cwd,
        env: process.env,
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
    child.unref();
    await logFd.close();
    return {
      ok: true,
      pid: child.pid,
      logFile,
      stdout: "",
      stderr: "",
      timedOut: false,
      interrupted: false,
      spawnEnforced: Boolean(check.enforced),
      osSandboxed,
    };
  }

  return new Promise((resolve) => {
    const child = spawn(spec.exe, spec.argv, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let interrupted = false;
    const max = 2_000_000;

    child.stdout.on("data", (c) => {
      if (stdout.length < max) stdout += c.toString();
    });
    child.stderr.on("data", (c) => {
      if (stderr.length < max) stderr += c.toString();
    });

    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGKILL");
        } catch {
          /* */
        }
      }, timeoutMs);
    }

    const onAbort = () => {
      interrupted = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* */
      }
    };
    if (ctx.signal) {
      if (ctx.signal.aborted) onAbort();
      else ctx.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        ok: !timedOut && !interrupted && code === 0,
        stdout,
        stderr,
        exitCode: code ?? 1,
        timedOut,
        interrupted,
        spawnEnforced: Boolean(check.enforced),
        osSandboxed,
      });
    });
  });
}

export const BashTool = {
  name: "xclaw_bash",
  description:
    "Executes a given bash command in a fresh shell at the session working directory.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Bash command to run" },
      timeout: { type: "number", description: "Timeout seconds" },
      background: { type: "boolean" },
    },
    required: ["command"],
  },
  execute: executeBash,
  call: async (args, ctx) => executeBash(args, ctx),
};

export const runBash = executeBash;

export default BashTool;
