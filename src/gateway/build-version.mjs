/**
 * Which build is this process actually running?
 *
 * Every gateway version surface used to answer that question by reading
 * `package.json` off disk AT REQUEST TIME — four byte-identical `pkgVersion()`
 * copies (dashboard.mjs, metrics.mjs, report.mjs) plus an inline read in the
 * `/version` route, and stop-health's fallback. A long-lived gateway on a box
 * with a self-deployer therefore reported whatever the checkout had been
 * bumped to, which is not what it is executing. Observed live on this box:
 *
 *   /version      -> 3.303.0   (disk, read during the request)
 *   /gateway/info -> 3.302.0   (frozen at import = the running build)
 *   /health       -> 3.302.0
 *   uptimeSec 757 — the process had never restarted since the bump
 *
 * `/version` named a build that had never executed. The worst of the five is
 * `/metrics`: `xclaw_info{version="…"}` is exactly the gauge a scraper uses to
 * confirm a rollout reached a host, so a stale process could report itself as
 * upgraded and satisfy its own deploy check.
 *
 * The fix is one primitive, read ONCE. `src/gateway/index.mjs` imports this
 * module statically, so the read happens at process boot and every later
 * dynamic import gets the same module instance — a lazily-imported module
 * would otherwise memoize whatever was on disk at first request, which is the
 * same bug with extra steps.
 *
 * Drift is not hidden either: it is a normal, expected state between a deploy
 * and a restart, so `/version` publishes it and `xclaw doctor` reports it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");

function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(PKG, "utf8")).version || "0.0.0";
  } catch {
    return null;
  }
}

/**
 * The version of the code this process loaded, frozen at module evaluation.
 * Falls back to "0.0.0" so every caller keeps a string, exactly as the five
 * `pkgVersion()` copies it replaces did.
 */
const RUNNING_VERSION = readVersion() || "0.0.0";

/** The build this process is executing. Never re-reads disk. */
export function runningVersion() {
  return RUNNING_VERSION;
}

/** What the checkout says NOW. Null when package.json is unreadable. */
export function readOnDiskVersion() {
  return readVersion();
}

/** "3.303.0" -> [3,303,0]; null when any of the first three parts is not numeric. */
function numericParts(v) {
  if (typeof v !== "string") return null;
  const out = [];
  for (const seg of v.split(".").slice(0, 3)) {
    const n = Number.parseInt(seg, 10);
    if (!Number.isFinite(n) || !/^\d+/.test(seg)) return null;
    out.push(n);
  }
  return out.length === 3 ? out : null;
}

/** -1 if a<b, 1 if a>b, 0 if equal, null when the pair is not comparable. */
export function compareVersions(a, b) {
  const pa = numericParts(a);
  const pb = numericParts(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/**
 * The version payload a route should publish: the running build under
 * `version` (the field everything already reads), plus the drift.
 *
 * An unreadable package.json yields `onDiskVersion: null` and `stale: false` —
 * a failed read is not evidence of drift, and inventing one would page an
 * operator over a permissions error.
 */
export function buildReport(running = runningVersion(), onDisk = readOnDiskVersion()) {
  const version = running || "0.0.0";
  const stale = Boolean(onDisk && onDisk !== version);
  const cmp = stale ? compareVersions(version, onDisk) : 0;
  return {
    version,
    onDiskVersion: onDisk ?? null,
    stale,
    // -1 means the checkout moved ahead: the ordinary post-deploy window.
    ...(stale ? { staleReason: cmp === -1 ? "restart-pending" : "checkout-behind" } : {}),
  };
}

/** What `xclaw doctor` should conclude. Drift is a warn, never an error: it is
 *  the expected state for the seconds between a deploy and its restart, and an
 *  operator who is mid-deploy should not be told the box is broken. */
export function summarizeBuildDrift(running, onDisk) {
  const r = buildReport(running, onDisk);
  if (!r.stale) return { severity: "ok", message: `running ${r.version}` };
  if (r.staleReason === "restart-pending") {
    return {
      severity: "warn",
      message:
        `running ${r.version} but ${r.onDiskVersion} is on disk — ` +
        `this process has not picked up the deploy (restart: pm2 restart xclaw-gateway)`,
    };
  }
  return {
    severity: "warn",
    message:
      `running ${r.version} but the checkout is at ${r.onDiskVersion} — ` +
      `the process is ahead of its source`,
  };
}

export default { runningVersion, readOnDiskVersion, compareVersions, buildReport, summarizeBuildDrift };
