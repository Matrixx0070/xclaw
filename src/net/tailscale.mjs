/**
 * Tailscale exposure for the XClaw gateway.
 *
 * XClaw can front its gateway with Tailscale so you reach it from your other
 * devices without opening a port on the public internet. Three modes:
 *
 *   off    — no exposure; the gateway stays bound to loopback (default)
 *   serve  — private HTTPS reachable only by machines on your tailnet
 *   funnel — public HTTPS reachable from the internet (ports 443/8443/10000)
 *
 * Like the rest of XClaw's shell-outs (see src/security/os-sandbox.mjs), this is
 * a thin driver over the `tailscale` CLI — it never talks to the daemon socket
 * or links a Go library. We shell to:
 *   tailscale status --json        → resolve the tailnet host / IP
 *   tailscale serve  --bg --yes P  → front loopback:P over tailnet HTTPS
 *   tailscale funnel --bg --yes P  → front loopback:P over public HTTPS
 *   tailscale serve|funnel reset   → tear the route down
 *   tailscale whois  --json IP     → map a connecting IP to a tailnet identity
 *
 * The `--bg` background model is the stable, documented Tailscale contract:
 * `serve`/`funnel` register a persistent route and return immediately, and
 * `reset` removes it. Exposure always fronts 127.0.0.1 — the gateway itself
 * stays on loopback and Tailscale is the only front door (see
 * coupleTailscaleExposure, which forces that invariant at config-load time).
 *
 * Clean-room XClaw implementation: behaviour mirrors the public, documented
 * Tailscale CLI contract; no third-party source is copied.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";

/** Common install locations to probe when `tailscale` is not on PATH. */
const COMMON_BIN_PATHS = [
  "/usr/bin/tailscale",
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
];

/** Funnel is only routable on these three ports (Tailscale product limit). */
export const FUNNEL_ALLOWED_PORTS = [443, 8443, 10000];

/** Bind modes accepted by resolveGatewayBindHost / gateway.bind. */
export const GATEWAY_BIND_MODES = ["loopback", "lan", "tailnet", "auto", "custom"];

/** Exposure modes accepted by gateway.tailscale.mode. */
export const TAILSCALE_MODES = ["off", "serve", "funnel"];

let _cachedBin; // undefined = unprobed, null = missing, string = resolved path

/**
 * Default synchronous exec — the seam every higher-level function accepts so
 * tests can inject a fake `tailscale` without touching the real binary.
 * @param {string} bin
 * @param {string[]} args
 * @param {{ timeoutMs?: number, maxBuffer?: number }} [opts]
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
export function defaultExec(bin, args, { timeoutMs = 5000, maxBuffer = 400_000 } = {}) {
  const r = spawnSync(bin, args, { encoding: "utf8", timeout: timeoutMs, maxBuffer });
  return {
    status: typeof r.status === "number" ? r.status : r.error ? -1 : 1,
    stdout: r.stdout || "",
    stderr: r.stderr || (r.error ? String(r.error.message || r.error) : ""),
  };
}

/**
 * Resolve the `tailscale` binary path, or null when it is not installed.
 * Honours XCLAW_TAILSCALE_BIN (ops/test override), then PATH, then the common
 * install locations. Result is cached; pass { force:true } to re-probe.
 * @param {{ force?: boolean }} [opts]
 * @returns {string | null}
 */
export function findTailscaleBinary({ force = false } = {}) {
  const envBin = String(process.env.XCLAW_TAILSCALE_BIN || "").trim();
  if (envBin) {
    _cachedBin = envBin;
    return envBin;
  }
  if (!force && _cachedBin !== undefined) return _cachedBin;

  // PATH lookup via which/where, then verify it actually runs.
  try {
    const finder = process.platform === "win32" ? "where" : "which";
    const which = defaultExec(finder, ["tailscale"], { timeoutMs: 3000 });
    const cand = String(which.stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    if (cand && _probeBinary(cand)) {
      _cachedBin = cand;
      return cand;
    }
  } catch {
    /* fall through to common paths */
  }

  for (const p of COMMON_BIN_PATHS) {
    try {
      if (fs.existsSync(p) && _probeBinary(p)) {
        _cachedBin = p;
        return p;
      }
    } catch {
      /* try next */
    }
  }

  _cachedBin = null;
  return null;
}

function _probeBinary(bin) {
  try {
    return defaultExec(bin, ["--version"], { timeoutMs: 3000 }).status === 0;
  } catch {
    return false;
  }
}

/** Test helper — clear the binary-detection cache. */
export function resetTailscaleBinaryCache() {
  _cachedBin = undefined;
}

/**
 * Parse a JSON object out of CLI stdout that may be prefixed with human log
 * lines. Slices between the first `{` and last `}` before JSON.parse.
 * @param {string} stdout
 * @returns {any}
 */
export function parseNoisyJson(stdout) {
  const t = String(stdout || "").trim();
  if (!t) return {};
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  const slice = start >= 0 && end > start ? t.slice(start, end + 1) : t;
  return JSON.parse(slice);
}

/**
 * Preferred tailnet host for URLs/origins from a parsed `status --json`:
 * Self.DNSName (trailing dot stripped) if present, else the first Tailscale IP.
 * @param {any} parsed
 * @returns {string | null}
 */
export function tailnetHostFromStatus(parsed) {
  const self = parsed && typeof parsed.Self === "object" && parsed.Self ? parsed.Self : null;
  if (!self) return null;
  const dns = typeof self.DNSName === "string" ? self.DNSName.trim() : "";
  if (dns) return dns.replace(/\.$/, "");
  const ips = Array.isArray(self.TailscaleIPs) ? self.TailscaleIPs : [];
  const ip = ips.find((x) => typeof x === "string" && x.trim());
  return ip ? ip.trim() : null;
}

/**
 * First Tailscale IP from a parsed `status --json`. Used for BINDING (an IP is
 * bindable; a DNSName is not), unlike tailnetHostFromStatus which prefers the
 * DNS name for display.
 * @param {any} parsed
 * @returns {string | null}
 */
export function tailnetIpFromStatus(parsed) {
  const self = parsed && typeof parsed.Self === "object" && parsed.Self ? parsed.Self : null;
  const ips = self && Array.isArray(self.TailscaleIPs) ? self.TailscaleIPs : [];
  const ip = ips.find((x) => typeof x === "string" && x.trim());
  return ip ? ip.trim() : null;
}

/**
 * Resolve the tailnet host (DNS-preferred) via `tailscale status --json`.
 * Degrades to null rather than throwing when the CLI is absent or errors.
 * @param {{ exec?: Function, bin?: string | null }} [opts]
 * @returns {string | null}
 */
export function getTailnetHost({ exec = defaultExec, bin = findTailscaleBinary() } = {}) {
  if (!bin) return null;
  try {
    const r = exec(bin, ["status", "--json"], { timeoutMs: 5000, maxBuffer: 400_000 });
    if (r.status !== 0) return null;
    return tailnetHostFromStatus(parseNoisyJson(r.stdout));
  } catch {
    return null;
  }
}

/**
 * Resolve the first tailnet IP (bindable) via `tailscale status --json`.
 * @param {{ exec?: Function, bin?: string | null }} [opts]
 * @returns {string | null}
 */
export function getTailnetIp({ exec = defaultExec, bin = findTailscaleBinary() } = {}) {
  if (!bin) return null;
  try {
    const r = exec(bin, ["status", "--json"], { timeoutMs: 5000, maxBuffer: 400_000 });
    if (r.status !== 0) return null;
    return tailnetIpFromStatus(parseNoisyJson(r.stdout));
  } catch {
    return null;
  }
}

/**
 * Register a background tailnet HTTPS route to loopback:port.
 * @param {number} port
 * @param {{ exec?: Function, bin?: string | null }} [opts]
 * @returns {{ ok: boolean, error?: string }}
 */
export function enableTailscaleServe(port, { exec = defaultExec, bin = findTailscaleBinary() } = {}) {
  if (!bin) return { ok: false, error: "tailscale binary not found" };
  const r = exec(bin, ["serve", "--bg", "--yes", String(port)], { timeoutMs: 15_000 });
  return r.status === 0
    ? { ok: true }
    : { ok: false, error: String(r.stderr || r.stdout || "serve failed").trim() };
}

/**
 * Tear down the tailnet HTTPS route (`tailscale serve reset`).
 * @param {{ exec?: Function, bin?: string | null }} [opts]
 * @returns {{ ok: boolean, error?: string }}
 */
export function disableTailscaleServe({ exec = defaultExec, bin = findTailscaleBinary() } = {}) {
  if (!bin) return { ok: false, error: "tailscale binary not found" };
  const r = exec(bin, ["serve", "reset"], { timeoutMs: 10_000 });
  return r.status === 0
    ? { ok: true }
    : { ok: false, error: String(r.stderr || r.stdout || "serve reset failed").trim() };
}

/**
 * Register a background public (internet) HTTPS route to loopback:port.
 * @param {number} port
 * @param {{ exec?: Function, bin?: string | null }} [opts]
 * @returns {{ ok: boolean, error?: string }}
 */
export function enableTailscaleFunnel(port, { exec = defaultExec, bin = findTailscaleBinary() } = {}) {
  if (!bin) return { ok: false, error: "tailscale binary not found" };
  const r = exec(bin, ["funnel", "--bg", "--yes", String(port)], { timeoutMs: 15_000 });
  return r.status === 0
    ? { ok: true }
    : { ok: false, error: String(r.stderr || r.stdout || "funnel failed").trim() };
}

/**
 * Tear down the public HTTPS route (`tailscale funnel reset`).
 * @param {{ exec?: Function, bin?: string | null }} [opts]
 * @returns {{ ok: boolean, error?: string }}
 */
export function disableTailscaleFunnel({ exec = defaultExec, bin = findTailscaleBinary() } = {}) {
  if (!bin) return { ok: false, error: "tailscale binary not found" };
  const r = exec(bin, ["funnel", "reset"], { timeoutMs: 10_000 });
  return r.status === 0
    ? { ok: true }
    : { ok: false, error: String(r.stderr || r.stdout || "funnel reset failed").trim() };
}

function _str(v) {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/**
 * Extract { login, name? } from a parsed `whois --json` payload. Login is
 * required (returns null without it); name is best-effort.
 * @param {any} payload
 * @returns {{ login: string, name?: string } | null}
 */
export function parseWhoisIdentity(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  const profile =
    (p.UserProfile && typeof p.UserProfile === "object" ? p.UserProfile : null) ||
    (p.userProfile && typeof p.userProfile === "object" ? p.userProfile : null) ||
    (p.User && typeof p.User === "object" ? p.User : null) ||
    {};
  const login =
    _str(profile.LoginName) ||
    _str(profile.Login) ||
    _str(profile.login) ||
    _str(p.LoginName) ||
    _str(p.login);
  if (!login) return null;
  const name =
    _str(profile.DisplayName) ||
    _str(profile.Name) ||
    _str(profile.displayName) ||
    _str(p.DisplayName) ||
    _str(p.name);
  return name ? { login, name } : { login };
}

const _whoisCache = new Map(); // ip -> { value, expiresAt }

/**
 * Map a connecting IP to a tailnet identity via `tailscale whois --json`, with
 * a short TTL cache (success 60s, error 5s) so a burst of requests from the
 * same peer costs one CLI call. Degrades to null when the CLI is absent/errors.
 * @param {string} ip
 * @param {{ exec?: Function, bin?: string | null, cacheTtlMs?: number, errorTtlMs?: number, now?: number }} [opts]
 * @returns {{ login: string, name?: string } | null}
 */
export function readTailscaleWhoisIdentity(
  ip,
  {
    exec = defaultExec,
    bin = findTailscaleBinary(),
    cacheTtlMs = 60_000,
    errorTtlMs = 5_000,
    now = Date.now(),
  } = {}
) {
  const key = String(ip || "").trim();
  if (!key) return null;
  const cached = _whoisCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  if (!bin) return null;
  try {
    const r = exec(bin, ["whois", "--json", key], { timeoutMs: 5000, maxBuffer: 200_000 });
    if (r.status !== 0) {
      _whoisCache.set(key, { value: null, expiresAt: now + errorTtlMs });
      return null;
    }
    const identity = parseWhoisIdentity(parseNoisyJson(r.stdout));
    _whoisCache.set(key, { value: identity, expiresAt: now + cacheTtlMs });
    return identity;
  } catch {
    _whoisCache.set(key, { value: null, expiresAt: now + errorTtlMs });
    return null;
  }
}

/** Test helper — clear the whois identity cache. */
export function resetTailscaleWhoisCache() {
  _whoisCache.clear();
}

/**
 * `https://<host>` origin for a tailnet host (trailing dot stripped), or null.
 * @param {string | null} host
 * @returns {string | null}
 */
export function tailnetHttpsOrigin(host) {
  const h = String(host || "").trim().replace(/\.$/, "");
  return h ? `https://${h}` : null;
}

/**
 * Resolve the effective listen host from cfg.gateway.bind:
 *   loopback|auto → 127.0.0.1
 *   lan           → 0.0.0.0
 *   tailnet       → the tailnet IP (falls back to loopback if unavailable)
 *   custom|other  → the explicit cfg.gateway.host unchanged (back-compat)
 * @param {object} [cfg]
 * @param {{ exec?: Function, bin?: string | null }} [opts]
 * @returns {string}
 */
export function resolveGatewayBindHost(cfg = {}, { exec = defaultExec, bin } = {}) {
  const g = cfg.gateway || {};
  const explicitHost = typeof g.host === "string" && g.host ? g.host : "127.0.0.1";
  switch (String(g.bind || "").toLowerCase()) {
    case "loopback":
    case "auto":
      return "127.0.0.1";
    case "lan":
      return "0.0.0.0";
    case "tailnet": {
      const ip = getTailnetIp({ exec, bin: bin ?? findTailscaleBinary() });
      return ip || "127.0.0.1"; // degrade to loopback when the tailnet is down
    }
    case "custom":
    default:
      return explicitHost;
  }
}

/**
 * Pure config coupling: when Tailscale serve/funnel is active the gateway MUST
 * stay on loopback (Tailscale is the only front door — binding LAN/tailnet while
 * a public Funnel is live would expose the gateway directly, bypassing the front
 * door), and Funnel — being public internet — MUST have auth on. Returns a new
 * cfg with those invariants forced; records what it overrode on
 * `_tailscaleCoupling` for honest doctor/log reporting. Mode `off` is a no-op.
 * @param {object} [cfg]
 * @returns {object}
 */
export function coupleTailscaleExposure(cfg = {}) {
  const g = cfg.gateway || {};
  const mode = String(g.tailscale?.mode || "off").toLowerCase();
  if (mode !== "serve" && mode !== "funnel") return cfg;

  const notes = [];
  if (g.bind && String(g.bind).toLowerCase() !== "loopback") {
    notes.push(`forced gateway.bind=loopback (was ${g.bind}) — tailscale ${mode} fronts loopback`);
  }
  if (g.host && g.host !== "127.0.0.1") {
    notes.push(`forced gateway.host=127.0.0.1 (was ${g.host}) — tailscale ${mode} fronts loopback`);
  }
  const nextGateway = {
    ...g,
    bind: "loopback",
    host: "127.0.0.1",
    tailscale: { ...(g.tailscale || {}), mode },
  };
  if (mode === "funnel" && nextGateway.authStrict !== true) {
    nextGateway.authStrict = true;
    notes.push("forced gateway.authStrict=true — funnel is public on the internet");
  }
  const out = { ...cfg, gateway: nextGateway };
  if (notes.length) out._tailscaleCoupling = [...(cfg._tailscaleCoupling || []), ...notes];
  return out;
}

/**
 * Start the configured Tailscale exposure for a listening gateway. Returns a
 * handle { mode, host, active, stop() } or null when mode is off. Never throws
 * for operational failures — it logs and returns an inactive handle so a
 * tailscale hiccup can never take the gateway down.
 *
 * When the tailnet host resolves and cfg.gateway.corsOrigin is an allowlist
 * array, the tailnet HTTPS origin is appended so the Control UI served over the
 * tailnet host can call the gateway.
 *
 * @param {{ cfg?: object, port?: number, log?: Function, exec?: Function, bin?: string | null }} opts
 * @returns {{ mode: string, host: string | null, active: boolean, stop: Function } | null}
 */
export function startGatewayTailscaleExposure({ cfg = {}, port, log = () => {}, exec = defaultExec, bin } = {}) {
  const g = cfg.gateway || {};
  const ts = g.tailscale || {};
  const mode = String(ts.mode || "off").toLowerCase();
  if (mode !== "serve" && mode !== "funnel") return null;

  const p = Number(port ?? g.port);
  const resolvedBin = bin !== undefined ? bin : findTailscaleBinary();
  if (!resolvedBin) {
    log(
      `Tailscale ${mode} requested but the tailscale binary was not found — exposure NOT active ` +
        `(install from https://tailscale.com/download, then restart).`
    );
    return { mode, host: null, active: false, stop: () => {} };
  }

  if (mode === "funnel" && !FUNNEL_ALLOWED_PORTS.includes(p)) {
    log(
      `Warning: Tailscale Funnel only routes ports ${FUNNEL_ALLOWED_PORTS.join("/")} — gateway port ${p} ` +
        `will likely be rejected. Set gateway.port to one of those to use funnel.`
    );
  }

  const res =
    mode === "serve"
      ? enableTailscaleServe(p, { exec, bin: resolvedBin })
      : enableTailscaleFunnel(p, { exec, bin: resolvedBin });
  if (!res.ok) {
    log(`Tailscale ${mode} failed: ${res.error} — exposure NOT active.`);
    return { mode, host: null, active: false, stop: () => {} };
  }

  const host = getTailnetHost({ exec, bin: resolvedBin });
  const origin = tailnetHttpsOrigin(host);
  if (origin && Array.isArray(g.corsOrigin) && !g.corsOrigin.includes(origin)) {
    g.corsOrigin.push(origin);
  }
  if (host) log(`Tailscale ${mode} active → https://${host}/  (fronting 127.0.0.1:${p})`);
  else log(`Tailscale ${mode} active (fronting 127.0.0.1:${p}); tailnet hostname not resolved yet.`);

  const resetOnExit = ts.resetOnExit === true;
  return {
    mode,
    host,
    active: true,
    stop: () => {
      if (!resetOnExit) return;
      const off =
        mode === "serve"
          ? disableTailscaleServe({ exec, bin: resolvedBin })
          : disableTailscaleFunnel({ exec, bin: resolvedBin });
      if (off.ok) log(`Tailscale ${mode} route reset on shutdown.`);
      else log(`Tailscale ${mode} reset failed: ${off.error}`);
    },
  };
}

export default {
  FUNNEL_ALLOWED_PORTS,
  GATEWAY_BIND_MODES,
  TAILSCALE_MODES,
  defaultExec,
  findTailscaleBinary,
  resetTailscaleBinaryCache,
  parseNoisyJson,
  tailnetHostFromStatus,
  tailnetIpFromStatus,
  getTailnetHost,
  getTailnetIp,
  enableTailscaleServe,
  disableTailscaleServe,
  enableTailscaleFunnel,
  disableTailscaleFunnel,
  parseWhoisIdentity,
  readTailscaleWhoisIdentity,
  resetTailscaleWhoisCache,
  tailnetHttpsOrigin,
  resolveGatewayBindHost,
  coupleTailscaleExposure,
  startGatewayTailscaleExposure,
};
