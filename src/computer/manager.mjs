/**
 * Computer service manager — supervised start/stop with PID + log files.
 */
import { spawn } from "node:child_process";
import { mitmEnvFromConfig, isMitmEnabled } from "../browser/mitm.mjs";
import path from "node:path";
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import { loadConfig } from "../config/load.mjs";

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

function isPidAlive(pid) {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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
    ok: Boolean(health.ok),
  };
}

export async function startComputer({ root, foreground = false, args = [] } = {}) {
  const cfg = await loadConfig();
  const url = computerBaseUrl(cfg);

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

  // Default: thin native computer (bundle only when engine=bundle / NATIVE=0)
  let resolveComputerEngine;
  try {
    ({ resolveComputerEngine } = await import("./engine.mjs"));
  } catch {
    resolveComputerEngine = () =>
      process.env.XCLAW_COMPUTER_NATIVE === "0" ||
      process.env.XCLAW_COMPUTER_ENGINE === "bundle"
        ? "bundle"
        : "native";
  }
  const engine = resolveComputerEngine(cfg);
  const useNative = engine === "native";
  const useGenerated = engine === "generated";
  if (useNative || useGenerated) {
    const thinEntry = useGenerated
      ? path.join(root, "src/computer/generated/computer-server.mjs")
      : path.join(root, "src/computer/thin-server.mjs");
    if (!fs.existsSync(thinEntry)) {
      throw new Error(
        useGenerated
          ? `Generated computer missing: ${thinEntry} — run npm run build:computer`
          : `Native computer entry not found: ${thinEntry}`
      );
    }
    console.log(
      `[xclaw] Starting ${useGenerated ? "GENERATED (C3)" : "NATIVE thin"} computer: ${thinEntry}`
    );
    const env = {
      ...process.env,
      ...cfg.computer?.env,
      PORT: String(cfg.computer?.port || 4243),
      HOST: cfg.computer?.host || "127.0.0.1",
      XCLAW_COMPUTER_PORT: String(cfg.computer?.port || 4243),
      XCLAW_COMPUTER_HOST: cfg.computer?.host || "127.0.0.1",
      XCLAW_ROOT: process.env.XCLAW_ROOT || root || process.cwd(),
    };
    const logPath = computerLogPath(cfg);
    await fsp.mkdir(path.dirname(logPath), { recursive: true });
    const logFd = fs.openSync(logPath, "a");
    child = spawn(process.execPath, [thinEntry], {
      cwd: root,
      env,
      stdio: foreground ? "inherit" : ["ignore", logFd, logFd],
      detached: !foreground,
    });
    if (!foreground) child.unref();
    await writePid(cfg, child.pid);
    await writeMeta(cfg, {
      engine: useGenerated ? "generated-c3" : "thin-native",
      entry: thinEntry,
      pid: child.pid,
      startedAt: new Date().toISOString(),
    });
    const ok = await waitForHealthy(cfg, { timeoutMs: 15_000 });
    if (!ok) {
      throw new Error(`Native computer failed /health at ${url}`);
    }
    console.log(`[xclaw] Native computer healthy at ${url}`);
    return { alreadyRunning: false, url, engine: "thin-native", pid: child.pid };
  }

  const entry = path.isAbsolute(cfg.computer.entry)
    ? cfg.computer.entry
    : path.join(root, cfg.computer.entry);

  if (!fs.existsSync(entry)) {
    throw new Error(`Computer entry not found: ${entry}`);
  }

  const env = {
    ...process.env,
    ...cfg.computer.env,
    ...mitmEnvFromConfig(cfg),
    PORT: String(cfg.computer.port),
    HOST: cfg.computer.host || "127.0.0.1",
    NODE_ENV: process.env.NODE_ENV || "production",
    // A2: computer process must resolve hooks-bridge + Horizon modules
    XCLAW_ROOT: process.env.XCLAW_ROOT || root || process.cwd(),
  };
  if (!env.XCLAW_HOOKS_BRIDGE) {
    const hb = path.join(env.XCLAW_ROOT, "src/computer/hooks-bridge.mjs");
    env.XCLAW_HOOKS_BRIDGE = hb;
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

  console.log(`[xclaw] Starting Computer: ${entry}`);
  console.log(`[xclaw] Computer listen: ${cfg.computer.host}:${cfg.computer.port}`);
  console.log(`[xclaw] Computer log: ${logPath}`);

  await appendLog(
    cfg,
    `\n===== start ${new Date().toISOString()} entry=${entry} =====\n`
  );

  child = spawn(process.execPath, [entry, ...args], {
    env,
    detached: !foreground,
    stdio: foreground ? "inherit" : ["ignore", logFd, logFd],
  });

  if (!foreground) {
    try {
      child.unref();
    } catch {
      /* */
    }
  }

  const pid = child.pid;
  await writePid(cfg, pid);
  await writeMeta(cfg, {
    pid,
    startedAt: new Date().toISOString(),
    entry,
    url,
    port: cfg.computer.port,
  });

  child.on("exit", (code, signal) => {
    const msg = `[xclaw] Computer exited code=${code} signal=${signal}`;
    console.log(msg);
    void appendLog(cfg, `[${new Date().toISOString()}] exit code=${code} signal=${signal}\n`);
    child = null;
    void clearPid(cfg);
  });

  child.on("error", (err) => {
    console.error(`[xclaw] Computer spawn error:`, err.message);
    void appendLog(cfg, `[${new Date().toISOString()}] spawn error: ${err.message}\n`);
  });

  try {
    fs.closeSync(logFd);
  } catch {
    /* */
  }

  const healthy = await waitForHealthy(cfg, {
    timeoutMs: cfg.computer?.startTimeoutMs ?? 45_000,
  });
  if (!healthy) {
    try {
      if (child) child.kill("SIGTERM");
    } catch {
      /* */
    }
    await appendLog(cfg, `[${new Date().toISOString()}] failed to become healthy at ${url}\n`);
    throw new Error(
      `Computer failed to become healthy at ${url} — see ${logPath}`
    );
  }
  console.log(`[xclaw] Computer healthy at ${url} (pid ${pid})`);
  await appendLog(cfg, `[${new Date().toISOString()}] healthy pid=${pid}\n`);

  if (foreground) {
    await new Promise((resolve) => {
      child.on("exit", resolve);
      const stop = () => child?.kill("SIGTERM");
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    });
  }

  return { pid, url, logPath };
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
