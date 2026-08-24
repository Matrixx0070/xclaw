/**
 * OS-level sandbox for tool spawn (Linux bubblewrap).
 *
 * When available, wraps bash in bwrap with:
 * - workspace RW bind
 * - optional --unshare-net (when egress deny / unshareNet)
 * - RO system paths for a usable shell
 * - private /tmp
 *
 * Config:
 *   security.osSandbox: "off" | "bwrap" | "auto"  (default auto)
 *   security.osSandboxUnshareNet: boolean (default: true when egress mode deny)
 *   security.osSandboxExtraRo: string[] extra RO binds
 * Env:
 *   XCLAW_OS_SANDBOX=off|bwrap|auto
 *   XCLAW_BWRAP=/path/to/bwrap
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getEgressPolicy } from "./egress.mjs";

let _bwrapPath = undefined; // undefined=unprobed, null=missing, string=path

/**
 * Resolve bwrap binary path or null.
 */
export function findBwrap() {
  if (_bwrapPath !== undefined) return _bwrapPath;
  const env = process.env.XCLAW_BWRAP;
  if (env && fs.existsSync(env)) {
    _bwrapPath = env;
    return _bwrapPath;
  }
  for (const c of ["bwrap", "/usr/bin/bwrap", "/bin/bwrap"]) {
    try {
      const r = spawnSync(c === "bwrap" ? "bwrap" : c, ["--version"], {
        encoding: "utf8",
        timeout: 3000,
      });
      if (r.status === 0) {
        _bwrapPath = c === "bwrap" ? "bwrap" : c;
        return _bwrapPath;
      }
    } catch {
      /* try next */
    }
  }
  _bwrapPath = null;
  return null;
}

/** Test helper — reset probe cache */
export function resetBwrapCache() {
  _bwrapPath = undefined;
  _bwrapWorks = undefined;
  _bwrapNetnsWorks = undefined;
}

/**
 * RO-bind argv pairs for the standard system dirs a usable shell needs.
 * Single-sourced so the usability probes exercise the exact same filesystem
 * view as the real sandbox — on merged-/usr hosts (/bin,/lib,/lib64,/sbin ->
 * usr/*) binding only /usr leaves the ELF interpreter unreachable, which made
 * the probe report bwrap "unusable" and silently disable a working sandbox.
 * @param {object} [cfg]
 * @returns {string[]}
 */
export function roBindDirsArgv(cfg = {}) {
  const roDirs = [
    "/usr",
    "/etc",
    "/bin",
    "/sbin",
    "/lib",
    "/lib64",
    "/lib32",
    ...(cfg?.security?.osSandboxExtraRo || []),
  ];
  /** @type {string[]} */
  const argv = [];
  const bound = new Set();
  for (const d of roDirs) {
    try {
      if (!fs.existsSync(d)) continue;
      let real = d;
      try {
        real = fs.realpathSync(d);
      } catch {
        /* keep d */
      }
      if (bound.has(real)) continue;
      argv.push("--ro-bind", d, d);
      bound.add(real);
      bound.add(d);
    } catch {
      /* skip */
    }
  }
  return argv;
}

let _bwrapWorks = undefined; // undefined=unprobed, true/false

/**
 * Can we actually enter a bwrap sandbox on this host?
 * (GitHub Actions often denies uid map setup.)
 */
export function probeBwrapWorks() {
  if (_bwrapWorks !== undefined) return _bwrapWorks;
  const bwrap = findBwrap();
  if (!bwrap) {
    _bwrapWorks = false;
    return false;
  }
  const cwd = process.cwd();
  // Bind the same system dirs as the real sandbox so the probe result matches
  // what the production wrap can actually do (see roBindDirsArgv).
  const args = [
    "--die-with-parent",
    ...roBindDirsArgv(),
    "--bind",
    cwd,
    cwd,
    "--chdir",
    cwd,
    "--",
    "/bin/true",
  ];
  try {
    const r = spawnSync(bwrap, args, { encoding: "utf8", timeout: 5000 });
    _bwrapWorks = r.status === 0;
    if (!_bwrapWorks) {
      // stash last error for doctor
      probeBwrapWorks.lastError = String(r.stderr || r.stdout || r.error || "bwrap probe failed");
    }
  } catch (e) {
    _bwrapWorks = false;
    probeBwrapWorks.lastError = String(e?.message || e);
  }
  return _bwrapWorks;
}

/**
 * @param {object} [cfg]
 * @returns {"off"|"bwrap"|"auto"}
 */
export function getOsSandboxMode(cfg = {}) {
  const env = String(process.env.XCLAW_OS_SANDBOX || "").toLowerCase();
  if (env === "off" || env === "0" || env === "false") return "off";
  if (env === "bwrap" || env === "on" || env === "1" || env === "true") return "bwrap";
  if (env === "auto") return "auto";
  const m = String(
    cfg?.security?.osSandbox || cfg?.osSandbox || ""
  ).toLowerCase();
  if (m === "off" || m === "bwrap" || m === "auto") return m;
  // prod → prefer bwrap when present; lab → auto (use if present)
  return "auto";
}

let _bwrapNetnsWorks = undefined; // undefined=unprobed, true/false

/**
 * Can this host create a network namespace via bwrap? Some CI hosts
 * (GitHub Actions) reject loopback setup (RTM_NEWADDR) in a fresh netns.
 */
export function probeBwrapNetns() {
  if (_bwrapNetnsWorks !== undefined) return _bwrapNetnsWorks;
  const bwrap = findBwrap();
  if (!bwrap || !probeBwrapWorks()) {
    _bwrapNetnsWorks = false;
    return false;
  }
  const cwd = process.cwd();
  try {
    const r = spawnSync(
      bwrap,
      [
        "--die-with-parent",
        "--unshare-net",
        ...roBindDirsArgv(),
        "--bind",
        cwd,
        cwd,
        "--chdir",
        cwd,
        "--",
        "/bin/true",
      ],
      { encoding: "utf8", timeout: 5000 }
    );
    _bwrapNetnsWorks = r.status === 0;
    if (!_bwrapNetnsWorks) {
      probeBwrapNetns.lastError = String(r.stderr || r.stdout || r.error || "bwrap netns probe failed");
    }
  } catch (e) {
    _bwrapNetnsWorks = false;
    probeBwrapNetns.lastError = String(e?.message || e);
  }
  return _bwrapNetnsWorks;
}

function shouldUnshareNet(cfg) {
  // Explicit config/env wins; otherwise the egress policy decides:
  // deny/allowlist means the netns is the enforcement boundary (the regex
  // command screen in egress.mjs is only a fast pre-check).
  if (cfg?.security?.osSandboxUnshareNet === false) return false;
  if (cfg?.security?.osSandboxUnshareNet === true) return true;
  if (process.env.XCLAW_OS_SANDBOX_NET === "allow") return false;
  if (process.env.XCLAW_OS_SANDBOX_NET === "deny") return true;
  return getEgressPolicy(cfg).mode !== "allow";
}

/**
 * Build bwrap argv prefix (not including the target command).
 * @returns {{ ok: true, bwrap: string, argvPrefix: string[] } | { ok: false, reason: string, error?: string }}
 */
export function buildBwrapArgv({
  cfg = {},
  cwd,
  workspace,
} = {}) {
  const mode = getOsSandboxMode(cfg);
  if (mode === "off") {
    return { ok: false, reason: "disabled" };
  }
  const bwrap = findBwrap();
  if (!bwrap) {
    if (mode === "bwrap") {
      return {
        ok: false,
        reason: "bwrap_missing",
        error:
          "security.osSandbox=bwrap but bubblewrap is not installed (apt install bubblewrap)",
      };
    }
    return { ok: false, reason: "bwrap_unavailable" };
  }

  const ws = path.resolve(workspace || cwd || process.cwd());
  const runCwd = path.resolve(cwd || ws);

  /** @type {string[]} */
  const argv = [
    "--die-with-parent",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
  ];

  // RO system paths (single-sourced with the usability probes)
  argv.push(...roBindDirsArgv(cfg));

  // Workspace RW
  argv.push("--bind", ws, ws);

  // If cwd outside workspace, bind it RW too (still constrained to that path)
  if (runCwd !== ws && !runCwd.startsWith(ws + path.sep)) {
    try {
      if (fs.existsSync(runCwd)) argv.push("--bind", runCwd, runCwd);
    } catch {
      /* skip */
    }
  }

  argv.push("--chdir", runCwd);

  let netIsolated = false;
  let netnsDegraded = false;
  if (shouldUnshareNet(cfg)) {
    if (probeBwrapNetns()) {
      argv.push("--unshare-net");
      netIsolated = true;
    } else {
      // Host cannot create a netns — sandbox still applies, but the network
      // boundary is degraded to the egress command screen. Surfaced so
      // callers/doctor can report honestly instead of claiming isolation.
      netnsDegraded = true;
    }
  }

  // Drop ambient capabilities as much as bwrap allows by default in user ns
  argv.push("--unshare-pid");

  return {
    ok: true,
    bwrap,
    argvPrefix: argv,
    workspace: ws,
    cwd: runCwd,
    netIsolated,
    netnsDegraded,
  };
}

/**
 * Wrap a spawn spec { exe, argv, cwd, env } with bwrap when enabled.
 * @returns {{ exe, argv, cwd, env, sandboxed: boolean, reason?: string }}
 */
export function wrapSpawnWithOsSandbox(spec, { cfg, workspace } = {}) {
  const mode = getOsSandboxMode(cfg);
  // Probe once: some CI hosts cannot set uid maps
  if (mode !== "off" && findBwrap() && !probeBwrapWorks()) {
    if (mode === "bwrap") {
      return {
        ...spec,
        sandboxed: false,
        deny: true,
        reason: "bwrap_unusable",
        error:
          probeBwrapWorks.lastError ||
          "bwrap installed but cannot create sandbox (uid map denied?)",
      };
    }
    return {
      exe: spec.exe,
      argv: spec.argv,
      cwd: spec.cwd,
      env: spec.env,
      sandboxed: false,
      reason: "bwrap_unusable_fallback",
    };
  }

  const built = buildBwrapArgv({
    cfg,
    cwd: spec.cwd,
    workspace: workspace || spec.cwd,
  });
  if (!built.ok) {
    // Hard fail only when mode is forced bwrap and missing
    if (built.reason === "bwrap_missing") {
      return {
        ...spec,
        sandboxed: false,
        deny: true,
        reason: built.reason,
        error: built.error,
      };
    }
    return {
      exe: spec.exe,
      argv: spec.argv,
      cwd: spec.cwd,
      env: spec.env,
      sandboxed: false,
      reason: built.reason || "off",
    };
  }

  return {
    exe: built.bwrap,
    argv: [...built.argvPrefix, "--", spec.exe, ...spec.argv],
    cwd: spec.cwd, // bwrap --chdir handles inside
    env: spec.env,
    sandboxed: true,
    netIsolated: Boolean(built.netIsolated),
    netnsDegraded: Boolean(built.netnsDegraded),
    reason: "bwrap",
  };
}

export default {
  findBwrap,
  resetBwrapCache,
  probeBwrapWorks,
  probeBwrapNetns,
  getOsSandboxMode,
  buildBwrapArgv,
  wrapSpawnWithOsSandbox,
};
