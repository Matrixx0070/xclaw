/**
 * XClaw daemon helpers — pid file + detached spawn + systemd unit.
 * Prefer true session leaders (setsid) so parent exit does not kill children.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { isPidAlive, isPidDefinitelyDead } from "../shared/pid-alive.mjs";
import { renderSystemdUnit } from "../daemon/systemd-unit.mjs";

export { isPidAlive, isPidDefinitelyDead } from "../shared/pid-alive.mjs";
export { renderSystemdUnit } from "../daemon/systemd-unit.mjs";

export function writePid(pidPath, pid) {
  fs.mkdirSync(path.dirname(pidPath), { recursive: true });
  fs.writeFileSync(pidPath, String(pid) + "\n", { mode: 0o600 });
}

export function readPid(pidPath) {
  try {
    return Number(fs.readFileSync(pidPath, "utf8").trim());
  } catch {
    return null;
  }
}

/**
 * Fully detach a process:
 * - stdio → log file
 * - detached: true + unref
 * - optional setsid via `shell: false` and env
 * - new process group
 */
export function startDaemon({
  cmd,
  args = [],
  pidPath,
  logPath,
  cwd,
  env,
  setsid = true,
}) {
  const existing = readPid(pidPath);
  if (isPidAlive(existing)) {
    return { ok: false, error: "already_running", pid: existing, pidPath, logPath };
  }
  if (existing && isPidDefinitelyDead(existing)) {
    try {
      fs.unlinkSync(pidPath);
    } catch {
      /* */
    }
  }

  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.mkdirSync(path.dirname(pidPath), { recursive: true });
  const out = fs.openSync(logPath, "a");

  const childEnv = { ...process.env, ...(env || {}) };
  // Prevent interactive TTY assumptions
  childEnv.NODE_NO_WARNINGS = childEnv.NODE_NO_WARNINGS || "1";

  let child;
  if (setsid && process.platform !== "win32") {
    // setsid makes a new session leader; survives parent shell death better
    child = spawn("setsid", [cmd, ...args], {
      cwd,
      env: childEnv,
      detached: true,
      stdio: ["ignore", out, out],
    });
  } else {
    child = spawn(cmd, args, {
      cwd,
      env: childEnv,
      detached: true,
      stdio: ["ignore", out, out],
    });
  }
  child.unref();
  writePid(pidPath, child.pid);
  return { ok: true, pid: child.pid, pidPath, logPath, setsid };
}

export function stopDaemon(pidPath, { signal = "SIGTERM", timeoutMs = 8000 } = {}) {
  const pid = readPid(pidPath);
  if (!isPidAlive(pid)) {
    try {
      fs.unlinkSync(pidPath);
    } catch {
      /* */
    }
    return { ok: true, stopped: false, reason: "not_running" };
  }
  try {
    // Kill process group when started with setsid (negative pid)
    try {
      process.kill(-pid, signal);
    } catch {
      process.kill(pid, signal);
    }
  } catch (err) {
    return { ok: false, error: err.message, pid };
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isPidAlive(pid)) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  if (isPidAlive(pid)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* */
      }
    }
  }
  try {
    fs.unlinkSync(pidPath);
  } catch {
    /* */
  }
  return { ok: true, stopped: true, pid };
}

export function daemonStatus(pidPath) {
  const pid = readPid(pidPath);
  const alive = isPidAlive(pid);
  return {
    pid,
    alive,
    definitelyDead: pid != null ? isPidDefinitelyDead(pid) : true,
    pidPath,
  };
}

export function systemdUnit(opts = {}) {
  return renderSystemdUnit({
    description: opts.description || "XClaw Gateway Supervisor",
    workingDirectory: opts.workdir || opts.workingDirectory,
    programArguments: opts.exec
      ? String(opts.exec).split(/\s+/)
      : opts.programArguments || ["node", "bin/xclaw.mjs", "supervisor", "start", "--fg"],
    environment: opts.environment,
    environmentFiles: opts.environmentFiles,
  });
}

/**
 * Write secrets to ~/.xclaw/env (mode 600) for EnvironmentFile=
 *
 * The file is unconditionally plaintext (systemd reads K=V), so the
 * owner-only mode is the sole at-rest control. writeFile's `mode` is
 * umask-masked and a no-op on an existing file — the chmod after the
 * write is the authoritative on-disk-mode line (sweep #58/#59/#60
 * idiom): a rewrite over a pre-existing or tampered world-readable env
 * file re-tightens it every time.
 */
export function writeEnvFile(envPath, vars = {}) {
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  const lines = Object.entries(vars)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}=${String(v).replace(/\n/g, "")}`);
  fs.writeFileSync(envPath, lines.join("\n") + "\n", { mode: 0o600 });
  try {
    fs.chmodSync(envPath, 0o600);
  } catch {
    /* windows */
  }
  return envPath;
}
