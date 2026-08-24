/**
 * Managed headless Chrome for the native computer engine.
 *
 * One Chrome per computer-server process, started lazily on the first tool
 * call that needs a real browser (jsCode, screenshot, click/type, network
 * capture) and reused for every call after that. Replaces the vendored CDP
 * bundle's private Chrome lifecycle (engine unification, ADR 0005).
 *
 * Resolution order:
 *   1. XCLAW_CDP_URL / CDP_URL        → attach to that endpoint (never spawn,
 *                                        never torn down by us)
 *   2. live managed instance          → reuse
 *   3. DevToolsActivePort in profile  → adopt a Chrome an earlier server
 *                                        process left running
 *   4. spawn --headless=new with an OS-assigned port (cdpPort=0) and discover
 *      the port from the DevToolsActivePort file
 *
 * Profile: ~/.xclaw/browser-profiles/computer by default — deliberately NOT
 * the shared vault default, so the computer server never fights the Control
 * UI dedicated browser (port 9224) for a profile lock.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildChromeArgs } from "./chrome-args.mjs";
import { findChromeBinary, clearStaleSingletons } from "../browser/dedicated.mjs";

export const DEFAULT_COMPUTER_PROFILE = path.join(
  os.homedir(),
  ".xclaw",
  "browser-profiles",
  "computer"
);

/** @type {{ host: string, port: number, pid: number|null, managed: boolean } | null} */
let current = null;
/** @type {import("node:child_process").ChildProcess | null} */
let child = null;
/** Serialize concurrent ensure() calls so we never spawn two Chromes. */
let ensuring = null;
let exitHookInstalled = false;

function parseCdpUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(String(raw));
    return { host: u.hostname || "127.0.0.1", port: Number(u.port) || 9222 };
  } catch {
    return null;
  }
}

/** External endpoint (attach-only) from env, if set. */
export function externalCdpEndpoint(env = process.env) {
  return parseCdpUrl(env.XCLAW_CDP_URL || env.CDP_URL || null);
}

/** GET http://host:port/json/version with a short timeout. */
export function probeCdp(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(
      { host, port, path: "/json/version", timeout: timeoutMs },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve({ ok: res.statusCode === 200, info: JSON.parse(body) });
          } catch {
            resolve({ ok: false });
          }
        });
      }
    );
    req.on("error", () => resolve({ ok: false }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false });
    });
  });
}

function resolveProfileDirSync(opts = {}) {
  const dir =
    opts.profileDir ||
    process.env.XCLAW_COMPUTER_PROFILE_DIR ||
    DEFAULT_COMPUTER_PROFILE;
  fs.mkdirSync(path.join(dir, "Default"), { recursive: true });
  return dir;
}

async function readDevToolsActivePort(profileDir) {
  try {
    const raw = await fsp.readFile(
      path.join(profileDir, "DevToolsActivePort"),
      "utf8"
    );
    const port = Number(raw.split(/\r?\n/)[0].trim());
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

async function waitForDevToolsPort(profileDir, spawnedAtMs, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const portFile = path.join(profileDir, "DevToolsActivePort");
  while (Date.now() < deadline) {
    try {
      const st = await fsp.stat(portFile);
      // Only trust a port file written by THIS launch (stale files linger).
      if (st.mtimeMs >= spawnedAtMs - 2000) {
        const port = await readDevToolsActivePort(profileDir);
        if (port) {
          const probe = await probeCdp("127.0.0.1", port, 1000);
          if (probe.ok) return port;
        }
      }
    } catch {
      /* not written yet */
    }
    if (child && child.exitCode != null) {
      throw new Error(
        `chrome exited (code ${child.exitCode}) before CDP came up`
      );
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`chrome CDP port not discovered within ${timeoutMs}ms`);
}

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  const kill = () => {
    try {
      if (child && child.exitCode == null) child.kill("SIGTERM");
    } catch {
      /* */
    }
  };
  process.on("exit", kill);
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      kill();
      process.exit(0);
    });
  }
}

/**
 * Ensure a CDP endpoint is available, spawning managed headless Chrome when
 * needed. Safe to call concurrently and repeatedly.
 *
 * @param {{ profileDir?: string, timeoutMs?: number, extraArgs?: string[] }} [opts]
 * @returns {Promise<{ host: string, port: number, managed: boolean, pid: number|null }>}
 */
export async function ensureChrome(opts = {}) {
  // 1. Operator-attached endpoint always wins; we never manage it.
  const external = externalCdpEndpoint();
  if (external) {
    return { ...external, managed: false, pid: null };
  }

  // 2. Live managed instance.
  if (current) {
    const probe = await probeCdp(current.host, current.port, 800);
    if (probe.ok) return current;
    current = null;
    child = null;
  }

  if (ensuring) return ensuring;
  ensuring = (async () => {
    const profileDir = resolveProfileDirSync(opts);

    // 3. Adopt a Chrome left by a previous server process on this profile.
    const previousPort = await readDevToolsActivePort(profileDir);
    if (previousPort) {
      const probe = await probeCdp("127.0.0.1", previousPort, 800);
      if (probe.ok) {
        current = {
          host: "127.0.0.1",
          port: previousPort,
          pid: null,
          managed: true,
        };
        return current;
      }
    }

    // 4. Fresh spawn.
    const binary = findChromeBinary();
    if (!binary) {
      throw new Error(
        "no Chrome/Chromium binary found (set XCLAW_BROWSER_BIN or install chromium)"
      );
    }
    clearStaleSingletons(profileDir, { force: false });
    const args = buildChromeArgs({
      userDataDir: profileDir,
      headless: true,
      cdpPort: 0,
      extra: ["about:blank", ...(opts.extraArgs || [])],
    });
    const spawnedAt = Date.now();
    child = spawn(binary, args, { stdio: "ignore" });
    // Never let the browser child pin this process's event loop (the
    // unref'd-timer/child drain bug class): the exit hook still SIGTERMs it.
    child.unref();
    child.on("exit", () => {
      if (current && current.pid === child?.pid) current = null;
    });
    installExitHook();

    const port = await waitForDevToolsPort(
      profileDir,
      spawnedAt,
      opts.timeoutMs ?? 20_000
    );
    current = { host: "127.0.0.1", port, pid: child.pid ?? null, managed: true };
    return current;
  })();

  try {
    return await ensuring;
  } finally {
    ensuring = null;
  }
}

/** Stop the managed Chrome (no-op for external/adopted endpoints without pid). */
export async function stopChrome() {
  const c = child;
  current = null;
  child = null;
  if (!c || c.exitCode != null) return { stopped: false };
  try {
    c.kill("SIGTERM");
  } catch {
    return { stopped: false };
  }
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && c.exitCode == null) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (c.exitCode == null) {
    try {
      c.kill("SIGKILL");
    } catch {
      /* */
    }
  }
  return { stopped: true };
}

/** Observability for /health and doctor. */
export function chromeSessionStatus() {
  return {
    running: Boolean(current),
    endpoint: current ? `${current.host}:${current.port}` : null,
    managed: current?.managed ?? false,
    pid: current?.pid ?? null,
    external: Boolean(externalCdpEndpoint()),
  };
}

/** Test helper — forget state without killing anything. */
export function _resetChromeSessionForTests() {
  current = null;
  child = null;
  ensuring = null;
}

export default { ensureChrome, stopChrome, chromeSessionStatus, externalCdpEndpoint, probeCdp };
