/**
 * Computer service manager — supervised start/stop with PID + log files.
 * Single engine: the unified CDP bundle (xclaw-server.mjs, ADR 0006).
 * The server manages its own Chrome internally; the manager's job is
 * process supervision by HTTP health plus wiring the native-source
 * bridges (hooks/motor/chrome-args + the A6 thin-server merge).
 */
import { spawn } from "node:child_process";
import { mitmEnvFromConfig, isMitmEnabled } from "../browser/mitm.mjs";
import { isPidAlive } from "../shared/pid-alive.mjs";
import path from "node:path";
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import { loadConfig } from "../config/load.mjs";
import {
  resolveComputerEngine,
  resolveComputerEntryPath,
  describeComputerEngine,
} from "./engine.mjs";

/** In-process child when we spawned it in this process */
let child = null;

function configDir(cfg) {
  return cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw");
}

export function computerProbeHost(cfg) {
  const h = cfg.computer?.host || "127.0.0.1";
  if (h === "0.0.0.0" || h === "::" || h === "[::]") return "127.0.0.1";
  return h;
}

export function computerBaseUrl(cfg) {
  if (cfg.computer?.remoteUrl) {
    return String(cfg.computer.remoteUrl).replace(/\/$/, "");
  }
  return `http://${computerProbeHost(cfg)}:${cfg.computer?.port || 4243}`;
}

export function computerPidPath(cfg) {
  return path.join(configDir(cfg), "computer.pid");
}

export function computerLogPath(cfg) {
  return path.join(configDir(cfg), "logs", "computer.log");
}

export function computerMetaPath(cfg) {
  return path.join(configDir(cfg), "computer.meta.json");
}

function probeHealth(cfg, timeoutMs = 1000) {
  const url = `${computerBaseUrl(cfg)}/health`;
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          resolve({ ok: false, statusCode: res.statusCode });
          return;
        }
        try {
          const j = JSON.parse(body);
          const st = j.status || j.state || "";
          const ok =
            st === "healthy" ||
            st === "ok" ||
            j.ok === true ||
            j.healthy === true;
          resolve({ ok, body: j, statusCode: res.statusCode });
        } catch {
          resolve({ ok: true, body: body.slice(0, 200), statusCode: res.statusCode });
        }
      });
    });
    req.on("error", (err) => resolve({ ok: false, error: err.message }));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ ok: false, error: "timeout" });
    });
  });
}

export async function waitForHealthy(cfg, { timeoutMs = 20000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const p = await probeHealth(cfg, 800);
    if (p.ok) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

export async function isComputerRunning(cfg) {
  const p = await probeHealth(cfg, 1200);
  return Boolean(p.ok);
}

async function readPid(cfg) {
  try {
    const raw = await fsp.readFile(computerPidPath(cfg), "utf8");
    const pid = Number(String(raw).trim());
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

async function writePid(cfg, pid) {
  const dir = configDir(cfg);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(computerPidPath(cfg), String(pid) + "\n");
}

async function writeMeta(cfg, meta) {
  const dir = configDir(cfg);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(computerMetaPath(cfg), JSON.stringify(meta, null, 2) + "\n");
}

async function clearPid(cfg) {
  try {
    await fsp.unlink(computerPidPath(cfg));
  } catch {
    /* */
  }
}

async function appendLog(cfg, line) {
  try {
    const lp = computerLogPath(cfg);
    await fsp.mkdir(path.dirname(lp), { recursive: true });
    await fsp.appendFile(lp, line);
  } catch {
    /* */
  }
}

/**
 * Full computer status aligned with readiness probe.
 */
export async function getComputerStatus(cfg) {
  const url = computerBaseUrl(cfg);
  const health = await probeHealth(cfg, 1200);
  const pid = await readPid(cfg);
  const pidAlive = isPidAlive(pid);
  let meta = null;
  try {
    meta = JSON.parse(await fsp.readFile(computerMetaPath(cfg), "utf8"));
  } catch {
    /* */
  }
  const inProcess = Boolean(child && !child.killed);
  const root = process.env.XCLAW_ROOT || process.cwd();
  const engineInfo = describeComputerEngine(cfg, root);
  return {
    url,
    healthy: Boolean(health.ok),
    health,
    pid,
    pidAlive,
    inProcess,
    childPid: child?.pid ?? null,
    logPath: computerLogPath(cfg),
    pidPath: computerPidPath(cfg),
    meta,
    engine: engineInfo,
    ok: Boolean(health.ok),
  };
}

export async function startComputer({ root, foreground = false } = {}) {
  const cfg = await loadConfig();
  const url = computerBaseUrl(cfg);
  const workRoot = root || process.env.XCLAW_ROOT || process.cwd();

  if (await isComputerRunning(cfg)) {
    console.log(`[xclaw] Computer already healthy at ${url}`);
    const st = await getComputerStatus(cfg);
    if (foreground) {
      console.log(`[xclaw] Attaching to existing Computer (Ctrl+C will not stop it)`);
      await new Promise(() => {});
    }
    return { alreadyRunning: true, url, status: st };
  }

  const existingPid = await readPid(cfg);
  if (existingPid && !isPidAlive(existingPid)) {
    console.log(`[xclaw] Removing stale computer pid ${existingPid}`);
    await clearPid(cfg);
  } else if (existingPid && isPidAlive(existingPid) && !(await isComputerRunning(cfg))) {
    console.warn(
      `[xclaw] Computer pid ${existingPid} alive but /health down — killing and restarting`
    );
    try {
      process.kill(existingPid, "SIGTERM");
    } catch {
      /* */
    }
    await new Promise((r) => setTimeout(r, 800));
    try {
      if (isPidAlive(existingPid)) process.kill(existingPid, "SIGKILL");
    } catch {
      /* */
    }
    await clearPid(cfg);
  }

  const engine = resolveComputerEngine(cfg);
  const engineInfo = describeComputerEngine(cfg, workRoot);
  const entry = resolveComputerEntryPath(cfg, workRoot);

  if (!fs.existsSync(entry)) {
    throw new Error(`Computer entry not found: ${entry}`);
  }
  console.log(`[xclaw] Starting computer (${engine}): ${entry}`);

  const env = {
    ...process.env,
    ...cfg.computer?.env,
    // MITM proxy/SPKI env so the managed headless Chrome inherits the
    // interception policy (chrome-args.mjs reads XCLAW_MITM*).
    ...mitmEnvFromConfig(cfg),
    PORT: String(cfg.computer?.port || 4243),
    HOST: cfg.computer?.host || "127.0.0.1",
    XCLAW_COMPUTER_PORT: String(cfg.computer?.port || 4243),
    XCLAW_COMPUTER_HOST: cfg.computer?.host || "127.0.0.1",
    XCLAW_ROOT: process.env.XCLAW_ROOT || workRoot,
    XCLAW_COMPUTER_ENGINE: engine,
    // Forward the SSRF policy so the native browser_tab enforces the same
    // guard as web_fetch (cloud metadata stays blocked in every mode).
    ...(process.env.XCLAW_SSRF || cfg.security?.ssrf?.mode
      ? { XCLAW_SSRF: process.env.XCLAW_SSRF || String(cfg.security.ssrf.mode) }
      : {}),
    ...(process.env.XCLAW_SSRF_ALLOW_PRIVATE === "1" || cfg.security?.ssrf?.allowPrivate === true
      ? { XCLAW_SSRF_ALLOW_PRIVATE: "1" }
      : {}),
  };
  // Bridge modules the bundle dynamically imports from native source
  // (A2 hooks / A4 motor / A5 chrome-args, and the A6 merge resolves via
  // XCLAW_ROOT directly).
  if (!env.XCLAW_HOOKS_BRIDGE) {
    env.XCLAW_HOOKS_BRIDGE = path.join(env.XCLAW_ROOT, "src/computer/hooks-bridge.mjs");
  }
  if (!env.XCLAW_MOTOR_BRIDGE) {
    env.XCLAW_MOTOR_BRIDGE = path.join(env.XCLAW_ROOT, "src/computer/motor-bridge.mjs");
  }
  if (!env.XCLAW_CHROME_ARGS_BRIDGE) {
    env.XCLAW_CHROME_ARGS_BRIDGE = path.join(env.XCLAW_ROOT, "src/computer/chrome-args-bridge.mjs");
  }
  if (isMitmEnabled(cfg)) {
    console.log(`[xclaw] MITM env injected for computer (port ${env.XCLAW_MITM_PORT || 4444})`);
  }

  const logPath = computerLogPath(cfg);
  await fsp.mkdir(path.dirname(logPath), { recursive: true });
  const logFd = fs.openSync(logPath, "a");
  child = spawn(process.execPath, [entry], {
    cwd: workRoot,
    env,
    stdio: foreground ? "inherit" : ["ignore", logFd, logFd],
    detached: !foreground,
  });
  if (!foreground) child.unref();

  child.on("exit", (code, signal) => {
    console.log(`[xclaw] Computer exited code=${code} signal=${signal}`);
    void appendLog(cfg, `[${new Date().toISOString()}] exit code=${code} signal=${signal}\n`);
    child = null;
    void clearPid(cfg);
  });
  child.on("error", (err) => {
    console.error(`[xclaw] Computer spawn error:`, err.message);
    void appendLog(cfg, `[${new Date().toISOString()}] spawn error: ${err.message}\n`);
  });

  await writePid(cfg, child.pid);
  await writeMeta(cfg, {
    engine,
    engineInfo,
    entry,
    pid: child.pid,
    startedAt: new Date().toISOString(),
    url,
  });
  await appendLog(
    cfg,
    `\n===== start ${new Date().toISOString()} engine=${engine} entry=${entry} =====\n`
  );
  try {
    fs.closeSync(logFd);
  } catch {
    /* */
  }

  const ok = await waitForHealthy(cfg, {
    timeoutMs: cfg.computer?.startTimeoutMs ?? 45_000,
  });
  if (!ok) {
    try {
      if (child) child.kill("SIGTERM");
    } catch {
      /* */
    }
    throw new Error(`Computer failed /health at ${url} — see ${logPath}`);
  }
  console.log(`[xclaw] Computer healthy at ${url}`);
  await appendLog(cfg, `[${new Date().toISOString()}] healthy pid=${child.pid} engine=${engine}\n`);

  if (foreground) {
    await new Promise((resolve) => {
      child.on("exit", resolve);
      const stop = () => child?.kill("SIGTERM");
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    });
  }

  return {
    alreadyRunning: false,
    url,
    engine,
    engineInfo,
    pid: child?.pid ?? null,
    logPath,
  };
}

export async function stopComputer(cfgArg) {
  const cfg = cfgArg || (await loadConfig());
  const pid = (child && child.pid) || (await readPid(cfg));

  if (child && !child.killed) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* */
    }
    child = null;
  }

  if (pid && isPidAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* */
    }
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && isPidAlive(pid)) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (isPidAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* */
      }
    }
  }

  await clearPid(cfg);
  await appendLog(cfg, `[${new Date().toISOString()}] stop requested\n`);
  return { ok: true, pid: pid || null };
}

export async function restartComputer({ root } = {}) {
  const cfg = await loadConfig();
  await stopComputer(cfg);
  await new Promise((r) => setTimeout(r, 400));
  return startComputer({ root, foreground: false });
}

export function getComputerChild() {
  return child;
}
