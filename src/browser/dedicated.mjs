/**
 * Dedicated UI browser launcher — `xclaw browser`.
 *
 * The Control/webchat surfaces want a dedicated Chrome (own profile, CDP
 * port, app window on the operator's display). Under a supervisor (pm2,
 * systemd) an unclean exit leaves Chrome's Singleton* profile locks behind
 * and every subsequent start dies instantly → supervisor crash-loop
 * (observed live: 425 restarts in a day, three manual interventions).
 *
 * This launcher self-heals: before spawning it removes Singleton locks whose
 * owning pid (from the `SingletonLock -> hostname-pid` symlink) is dead on
 * this host. Locks owned by a LIVE pid are respected — if the CDP port also
 * answers, the browser is simply already running.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { spawn } from "node:child_process";
import { isPidAlive } from "../shared/pid-alive.mjs";

const SINGLETON_FILES = ["SingletonLock", "SingletonSocket", "SingletonCookie"];

/** Parse `hostname-pid` from the SingletonLock symlink target. */
export function parseSingletonTarget(target) {
  const m = String(target || "").match(/^(.*)-(\d+)$/);
  if (!m) return null;
  return { host: m[1], pid: Number(m[2]) };
}

/** Liveness on this host; EPERM means "exists but not ours" (see pid-alive). */
const pidAlive = isPidAlive;

/**
 * @returns {{present: string[], ownerAlive: boolean|null, owner: {host,pid}|null}}
 */
export function inspectSingletons(profileDir) {
  const present = [];
  let owner = null;
  for (const f of SINGLETON_FILES) {
    const p = path.join(profileDir, f);
    try {
      fs.lstatSync(p);
      present.push(f);
      if (f === "SingletonLock") {
        owner = parseSingletonTarget(fs.readlinkSync(p));
      }
    } catch {
      /* absent */
    }
  }
  let ownerAlive = null;
  if (owner) {
    // a lock from another host is indeterminate — treat as alive (never steal)
    ownerAlive = owner.host !== os.hostname() ? true : pidAlive(owner.pid);
  } else if (present.length) {
    ownerAlive = false; // partial lock litter with no readable owner = stale
  }
  return { present, ownerAlive, owner };
}

/**
 * Remove stale singleton locks (owner pid dead on this host). Live locks are
 * kept unless force. @returns {{cleared: string[], kept: string[]}}
 */
export function clearStaleSingletons(profileDir, { force = false } = {}) {
  const { present, ownerAlive } = inspectSingletons(profileDir);
  if (!present.length) return { cleared: [], kept: [] };
  if (ownerAlive && !force) return { cleared: [], kept: present };
  const cleared = [];
  for (const f of present) {
    try {
      fs.rmSync(path.join(profileDir, f), { force: true });
      cleared.push(f);
    } catch {
      /* best effort */
    }
  }
  return { cleared, kept: [] };
}

export function findChromeBinary(override) {
  const candidates = [
    override,
    process.env.XCLAW_BROWSER_BIN,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch {
      /* next */
    }
  }
  return null;
}

export function buildBrowserArgs({ port = 9224, profileDir, url, app = true, extraArgs = [] } = {}) {
  return [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
    ...extraArgs,
    ...(url ? [app ? `--app=${url}` : url] : []),
  ];
}

function cdpUp(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/json/version", timeout: timeoutMs },
      (r) => {
        r.resume();
        resolve(r.statusCode === 200);
      }
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

/**
 * Launch (foreground — supervisor-friendly) with self-healing preflight.
 * checkOnly reports without spawning.
 */
export async function launchDedicatedBrowser(opts = {}) {
  const port = Number(opts.port || 9224);
  const profileDir = opts.profileDir || path.join(os.homedir(), ".xclaw", "control-ui-profile");
  fs.mkdirSync(profileDir, { recursive: true });

  if (await cdpUp(port)) {
    return { ok: true, alreadyRunning: true, port, profileDir };
  }
  const healed = clearStaleSingletons(profileDir, { force: opts.force === true });
  if (healed.kept.length && !opts.force) {
    // live owner but CDP down: a Chrome with this profile is running WITHOUT
    // our debug port (or still booting) — refuse to corrupt the profile
    return {
      ok: false,
      error: `profile locked by a live Chrome (${healed.kept.join(", ")}); CDP :${port} not answering — stop it or pass --force`,
      port,
      profileDir,
    };
  }
  const binary = findChromeBinary(opts.binary);
  if (!binary) {
    return { ok: false, error: "no Chrome/Chromium binary found (set XCLAW_BROWSER_BIN)", port, profileDir };
  }
  const args = buildBrowserArgs({ port, profileDir, url: opts.url, app: opts.app !== false, extraArgs: opts.extraArgs || [] });
  if (opts.checkOnly) {
    return { ok: true, wouldRun: `${binary} ${args.join(" ")}`, healed: healed.cleared, port, profileDir };
  }
  const env = { ...process.env, ...(opts.display ? { DISPLAY: opts.display } : {}) };
  const child = spawn(binary, args, { stdio: "inherit", env });
  return {
    ok: true,
    pid: child.pid,
    healed: healed.cleared,
    binary,
    port,
    profileDir,
    wait: () => new Promise((resolve) => child.on("close", resolve)),
  };
}
