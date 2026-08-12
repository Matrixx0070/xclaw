/**
 * CLEAN xclaw_bash — standalone, no xclaw-server.mjs scope.
 * P0 extraction: maintainable replacement for bash-tool.extracted.mjs reference.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const DEFAULT_TIMEOUT_SECONDS = 30;

/**
 * @param {object} input
 * @param {string} input.command
 * @param {number} [input.timeout]
 * @param {boolean} [input.background]
 * @param {object} [ctx]
 * @param {string} [ctx.cwd]
 * @param {AbortSignal} [ctx.signal]
 */
export async function runBash(input = {}, ctx = {}) {
  const command = String(input.command || "");
  if (!command.trim()) {
    return { ok: false, stdout: "", stderr: "command is required", exitCode: 1 };
  }
  const timeoutSec = Number(input.timeout ?? DEFAULT_TIMEOUT_SECONDS);
  const timeoutMs = Math.min(120_000, Math.max(0, timeoutSec * 1000));
  const cwd = ctx.cwd || process.cwd();
  const background = Boolean(input.background);

  if (background) {
    const logDir = path.join(os.tmpdir(), "xclaw-bash-bg");
    await fs.mkdir(logDir, { recursive: true });
    const logFile = path.join(logDir, `${crypto.randomBytes(6).toString("hex")}.log`);
    const logFd = await fs.open(logFile, "w");
    const child = spawn("/bin/bash", ["-lc", command], {
      cwd,
      detached: true,
      stdio: ["ignore", logFd.fd, logFd.fd],
      env: process.env,
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
    };
  }

  return new Promise((resolve) => {
    const child = spawn("/bin/bash", ["-lc", command], {
      cwd,
      env: process.env,
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
      command: { type: "string" },
      timeout: { type: "number", description: "Seconds (max 120)" },
      background: { type: "boolean" },
    },
    required: ["command"],
  },
  isReadOnly: () => false,
  async call(input, context = {}) {
    const data = await runBash(input, {
      cwd: context.cwd || context.workingDir || process.cwd(),
      signal: context.signal || context.abortController?.signal,
    });
    return { data };
  },
};

export default BashTool;
