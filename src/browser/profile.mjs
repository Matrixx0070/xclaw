/**
 * XClaw B0 — Durable Chromium profile vault.
 *
 * Prefer a persistent user-data-dir so cookies, localStorage, IndexedDB,
 * and service-worker state survive across agent sessions (human-like
 * "returning user" behaviour). Falls back to mkdtemp when no vault is
 * configured.
 *
 * Env / config:
 *   XCLAW_BROWSER_PROFILE_DIR   absolute path to durable vault root
 *   XCLAW_BROWSER_PROFILE_NAME  sub-profile (default "Default")
 *   XCLAW_BROWSER_COPY_SESSION  "1" to also seed from system Chrome Default
 *
 * Layout:
 *   $PROFILE_DIR/
 *     Default/          ← Chrome profile
 *     .xclaw-lock       ← optional lock file
 *     Last Version
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createWriteStream } from "node:fs";

export const DEFAULT_VAULT = path.join(os.homedir(), ".xclaw", "browser-profiles", "default");

/**
 * Resolve the user-data-dir to use for Chromium.
 * @param {{ profileDir?: string|null, ephemeral?: boolean }} opts
 * @returns {Promise<{ userDataDir: string, durable: boolean, created: boolean }>}
 */
export async function resolveProfileDir(opts = {}) {
  const envDir = process.env.XCLAW_BROWSER_PROFILE_DIR?.trim();
  const requested = opts.profileDir || envDir || null;

  if (opts.ephemeral || requested === "tmp" || requested === "ephemeral") {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-chrome-"));
    return { userDataDir: tmp, durable: false, created: true };
  }

  const root = requested || DEFAULT_VAULT;
  const abs = path.resolve(root);
  let created = false;

  try {
    await fs.access(abs);
  } catch {
    await fs.mkdir(abs, { recursive: true });
    created = true;
  }

  // Ensure Default subdir exists so Chrome doesn't recreate empty
  const defaultSub = path.join(abs, "Default");
  try {
    await fs.access(defaultSub);
  } catch {
    await fs.mkdir(defaultSub, { recursive: true });
    created = true;
  }

  // Write a tiny marker so operators know it's an XClaw vault
  try {
    await fs.writeFile(
      path.join(abs, ".xclaw-profile"),
      `xclaw-browser-profile\ncreated=${new Date().toISOString()}\n`,
      { flag: "wx" }
    );
  } catch {
    /* already exists */
  }

  return { userDataDir: abs, durable: true, created };
}

/**
 * Optionally seed durable profile from the system Chrome Default profile
 * (cookies + Local Storage + IndexedDB). Safe no-op when source missing.
 */
export async function seedFromSystemChrome(userDataDir) {
  if (process.env.XCLAW_BROWSER_COPY_SESSION !== "1") return { copied: [] };

  const platform = process.platform;
  let sourceRoot;
  if (platform === "darwin") {
    sourceRoot = path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome");
  } else if (platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    if (!local) return { copied: [] };
    sourceRoot = path.join(local, "Google", "Chrome", "User Data");
  } else {
    sourceRoot = path.join(os.homedir(), ".config", "google-chrome");
  }
  const source = path.join(sourceRoot, "Default");
  try {
    await fs.access(source);
  } catch {
    return { copied: [] };
  }

  const dest = path.join(userDataDir, "Default");
  await fs.mkdir(dest, { recursive: true });
  const copied = [];

  const files = ["Cookies", "Cookies-journal", "Preferences", "Secure Preferences"];
  const dirs = ["Local Storage", "IndexedDB", "Service Worker", "Session Storage"];

  for (const f of files) {
    try {
      await fs.copyFile(path.join(source, f), path.join(dest, f));
      copied.push(f);
    } catch {
      /* lock / missing */
    }
  }
  for (const d of dirs) {
    try {
      await fs.cp(path.join(source, d), path.join(dest, d), { recursive: true });
      copied.push(d + "/");
    } catch {
      /* */
    }
  }
  return { copied };
}

/**
 * Soft lock to avoid two Chromium instances fighting the same profile.
 * Returns release function.
 */
export async function acquireProfileLock(userDataDir, { timeoutMs = 15_000 } = {}) {
  const lockPath = path.join(userDataDir, ".xclaw-lock");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const fh = await fs.open(lockPath, "wx");
      await fh.writeFile(
        JSON.stringify({
          pid: process.pid,
          started: new Date().toISOString(),
        })
      );
      await fh.close();
      return async () => {
        try {
          await fs.unlink(lockPath);
        } catch {
          /* */
        }
      };
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  // Stale lock — take over after timeout
  try {
    await fs.unlink(lockPath);
  } catch {
    /* */
  }
  return acquireProfileLock(userDataDir, { timeoutMs: 5_000 });
}



/**
 * Horizon 3 — Origin-partitioned identity.
 * Isolates cookies/storage per host under the vault.
 *
 * Env:
 *   XCLAW_BROWSER_PROFILE_MODE=origin|shared  (default shared)
 *   XCLAW_BROWSER_ORIGIN_ROOT  override roots for origin profiles
 */
export function sanitizeOriginHost(input) {
  let host = String(input || "").trim().toLowerCase();
  try {
    if (host.includes("://")) host = new URL(host).hostname;
  } catch {
    /* */
  }
  host = host.replace(/^\[|\]$/g, "");
  host = host.split(":")[0];
  host = host.replace(/[^a-z0-9.-]/g, "_").replace(/^\.+|\.+$/g, "");
  if (!host || host === "localhost" || host === "127.0.0.1") return "local";
  return host.slice(0, 120) || "unknown";
}

export async function resolveOriginProfile(originOrUrl, opts = {}) {
  const mode = opts.mode || process.env.XCLAW_BROWSER_PROFILE_MODE || "shared";
  if (mode !== "origin") {
    const r = await resolveProfileDir(opts);
    return typeof r === "string" ? r : r.userDataDir;
  }
  const host = sanitizeOriginHost(originOrUrl || opts.origin || "default");
  const root =
    opts.vaultDir ||
    process.env.XCLAW_BROWSER_ORIGIN_ROOT ||
    path.join(os.homedir(), ".xclaw", "browser-profiles", "origins");
  const dir = path.join(root, host);
  await fs.mkdir(path.join(dir, "Default"), { recursive: true });
  return dir;
}

export async function listOriginProfiles(opts = {}) {
  const root =
    opts.root ||
    process.env.XCLAW_BROWSER_ORIGIN_ROOT ||
    path.join(os.homedir(), ".xclaw", "browser-profiles", "origins");
  try {
    const names = await fs.readdir(root);
    const out = [];
    for (const n of names) {
      try {
        const st = await fs.stat(path.join(root, n));
        if (st.isDirectory()) out.push({ host: n, path: path.join(root, n) });
      } catch {
        /* */
      }
    }
    return out.sort((a, b) => a.host.localeCompare(b.host));
  } catch {
    return [];
  }
}

export default {
  resolveProfileDir,
  seedFromSystemChrome,
  acquireProfileLock,
  DEFAULT_VAULT,
  sanitizeOriginHost,
  resolveOriginProfile,
  listOriginProfiles,
};

