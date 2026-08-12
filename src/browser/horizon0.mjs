/**
 * Horizon 0 — production-grade browser organism foundations.
 *
 * First principles:
 * - Identity (durable profile) is part of the organism
 * - CDP must be reachable under modern Chromium origin checks
 * - Containers die without --disable-dev-shm-usage
 * - Dual Chrome on one profile corrupts disk state → exclusive lock
 * - MITM CA must exist before first navigation when proxy is on
 * - Headed mode needs real geometry for human-like screenshots
 *
 * This module is the *source of truth* for production Chrome flags.
 * The computer bundle inlines equivalent logic (keep in sync).
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Build production Chromium args for XClaw computer-use.
 * @param {object} opts
 * @param {string} opts.userDataDir
 * @param {boolean} [opts.headless=true]
 * @param {number|string} [opts.cdpPort=0]  0 = ephemeral
 * @param {string[]} [opts.extra=[]]
 * @returns {string[]}
 */
export function buildProductionChromeArgs(opts = {}) {
  const {
    userDataDir,
    headless = true,
    cdpPort = 0,
    extra = [],
  } = opts;

  if (!userDataDir) throw new Error("H0 userDataDir required");

  const forceHeaded =
    process.env.XCLAW_BROWSER_HEADED === "1" ||
    process.env.XCLAW_BROWSER_HEADED === "true";
  const useHeadless = forceHeaded ? false : headless;

  const args = [
    `--remote-debugging-port=${cdpPort}`,
    "--remote-allow-origins=*",
    "--disable-dev-shm-usage",
    "--disable-crash-reporter",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${userDataDir}`,
  ];

  if (useHeadless) {
    args.unshift("--headless=new");
  } else {
    const win = process.env.XCLAW_BROWSER_WINDOW_SIZE || "1280,720";
    const scale = process.env.XCLAW_BROWSER_SCALE || "1";
    args.push(`--window-size=${win}`);
    args.push("--window-position=0,0");
    args.push(`--force-device-scale-factor=${scale}`);
  }

  if (process.env.XCLAW_BROWSER_UA) {
    args.push(`--user-agent=${process.env.XCLAW_BROWSER_UA}`);
  }

  // Sandbox: explicit env, CI, or common container signals
  const noSandbox =
    process.env.XCLAW_BROWSER_NO_SANDBOX === "1" ||
    process.env.XCLAW_BROWSER_NO_SANDBOX === "true" ||
    process.env.CI === "true" ||
    process.env.XCLAW_IN_DOCKER === "1" ||
    fs.existsSync("/.dockerenv");
  if (noSandbox) {
    args.push("--no-sandbox", "--test-type");
  }
  if (noSandbox || process.env.XCLAW_BROWSER_DISABLE_GPU === "1") {
    if (!args.includes("--disable-gpu")) args.push("--disable-gpu");
  }

  // MITM (caller may also pass chromeMitmArgs — we only add if env already set)
  if (process.env.XCLAW_CHROME_MITM_ARGS) {
    for (const a of String(process.env.XCLAW_CHROME_MITM_ARGS).split(/\s+/).filter(Boolean)) {
      if (!args.includes(a)) args.push(a);
    }
  } else if (
    process.env.XCLAW_MITM === "1" ||
    process.env.XCLAW_MITM === "true" ||
    process.env.XCLAW_MITM === "on" ||
    process.env.XCLAW_MITM === "yes"
  ) {
    const port = Number(process.env.XCLAW_MITM_PORT) || 4444;
    args.push(`--proxy-server=http://127.0.0.1:${port}`);
    args.push("--proxy-bypass-list=<-loopback>");
  }

  if (process.env.CHROMIUM_FLAGS) {
    for (const a of String(process.env.CHROMIUM_FLAGS).split(/\s+/).filter(Boolean)) {
      if (!args.includes(a)) args.push(a);
    }
  }

  for (const a of extra) {
    if (a && !args.includes(a)) args.push(a);
  }

  return args;
}

/**
 * Exclusive profile lock — prevents two Chromes on one user-data-dir.
 * @returns {Promise<{ok:boolean, lockPath?:string, reason?:string}>}
 */
export async function acquireDurableProfileLock(userDataDir, { pid = process.pid } = {}) {
  if (!userDataDir) return { ok: false, reason: "no_dir" };
  await fsp.mkdir(userDataDir, { recursive: true });
  const lockPath = path.join(userDataDir, ".xclaw-profile.lock");

  const tryCreate = async () => {
    const fh = await fsp.open(lockPath, "wx");
    await fh.writeFile(String(pid));
    await fh.close();
    return true;
  };

  try {
    await tryCreate();
    return { ok: true, lockPath };
  } catch (e) {
    if (e?.code !== "EEXIST") {
      return { ok: false, reason: e?.message || String(e) };
    }
    // Stale?
    try {
      const prev = (await fsp.readFile(lockPath, "utf8")).trim();
      const prevPid = Number(prev);
      if (prevPid && !Number.isNaN(prevPid)) {
        try {
          process.kill(prevPid, 0);
          return { ok: false, reason: `locked_by_pid_${prevPid}`, lockPath };
        } catch {
          // dead — reclaim
          await fsp.unlink(lockPath).catch(() => {});
          await tryCreate();
          return { ok: true, lockPath, reclaimed: true };
        }
      }
    } catch (inner) {
      return { ok: false, reason: inner?.message || String(inner), lockPath };
    }
    return { ok: false, reason: "locked", lockPath };
  }
}

export async function releaseDurableProfileLock(lockPath) {
  if (!lockPath) return;
  try {
    await fsp.unlink(lockPath);
  } catch {
    /* */
  }
}

/**
 * Rotate flows.jsonl when over max bytes (production disk hygiene).
 */
export async function rotateFileIfLarge(filePath, { maxBytes = 50 * 1024 * 1024, keep = 3 } = {}) {
  try {
    const st = await fsp.stat(filePath);
    if (st.size < maxBytes) return { rotated: false, size: st.size };
  } catch {
    return { rotated: false, size: 0 };
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `${filePath}.${ts}`;
  await fsp.rename(filePath, dest);
  // prune old
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  try {
    const names = (await fsp.readdir(dir))
      .filter((n) => n.startsWith(base + "."))
      .sort()
      .reverse();
    for (const n of names.slice(keep)) {
      await fsp.unlink(path.join(dir, n)).catch(() => {});
    }
  } catch {
    /* */
  }
  return { rotated: true, archive: dest };
}

/**
 * Horizon 0 readiness checklist (doctor / supervisor).
 */
export function horizon0Checklist(env = process.env) {
  const checks = [];
  checks.push({
    id: "profile",
    ok: true,
    detail: env.XCLAW_BROWSER_PROFILE_DIR
      ? `durable=${env.XCLAW_BROWSER_PROFILE_DIR}`
      : "ephemeral (set XCLAW_BROWSER_PROFILE_DIR for identity)",
    warn: !env.XCLAW_BROWSER_PROFILE_DIR,
  });
  checks.push({
    id: "headed",
    ok: true,
    detail:
      env.XCLAW_BROWSER_HEADED === "1" || env.XCLAW_BROWSER_HEADED === "true"
        ? "headed"
        : "headless",
  });
  checks.push({
    id: "humanize",
    ok: true,
    detail:
      env.XCLAW_BROWSER_HUMANIZE === "0" || env.XCLAW_BROWSER_HUMANIZE === "false"
        ? "disabled"
        : "enabled",
  });
  const mitm =
    env.XCLAW_MITM === "1" ||
    env.XCLAW_MITM === "true" ||
    env.XCLAW_MITM === "on" ||
    env.XCLAW_MITM === "yes";
  checks.push({
    id: "mitm",
    ok: true,
    detail: mitm ? `on port=${env.XCLAW_MITM_PORT || 4444}` : "off",
  });
  checks.push({
    id: "cdp_origins",
    ok: true,
    detail: "remote-allow-origins=* required on modern Chromium",
  });
  checks.push({
    id: "dev_shm",
    ok: true,
    detail: "disable-dev-shm-usage required in containers",
  });
  return checks;
}

export default {
  buildProductionChromeArgs,
  acquireDurableProfileLock,
  releaseDurableProfileLock,
  rotateFileIfLarge,
  horizon0Checklist,
};
