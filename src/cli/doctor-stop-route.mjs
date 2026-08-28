/**
 * Doctor: POST /stop helper + gateway mount.
 *
 * This probe used to answer "is the kill-switch mounted?" by grepping ONE file,
 * `src/gateway/index.mjs`, for marker strings — resolved against
 * `process.cwd()`. Both halves were wrong, in opposite directions:
 *
 *   • The routes extraction moved the mount to `src/gateway/routes/stop.mjs`.
 *     Run from the repo root, the grep found 0 markers in index.mjs and the
 *     probe reported `warn: gateway mount not detected` — while the live
 *     gateway answered `POST /stop -> 401`. A false alarm on the one route an
 *     operator must be able to trust.
 *
 *   • Run from anywhere else — which is every installed CLI, since `xclaw
 *     doctor` is normally run from the operator's own directory —
 *     `fs.existsSync` was false, the read never happened, and `mounted` kept
 *     its initial value `helperOk === true`. The probe then printed
 *     `ok: gateway mount markers present` as a positive claim about markers it
 *     had never read. That is the fail-open: the check passed hardest exactly
 *     where it checked nothing.
 *
 * The fix is to read the gateway sources relative to THIS module (`src/` ships
 * in the package, so the path holds in a repo and in an install alike), to
 * follow the actual dispatch chain instead of one filename, and to report
 * "not verified" when the sources cannot be read rather than inventing a
 * verdict. Mount is never assumed from the helper's existence.
 *
 * A live gateway is still the stronger witness — `gateway.stopProbe` proves the
 * route by calling it (GET → 405, POST → 401). This check is the static twin
 * that also works with no gateway running.
 */
import { isStopPath } from "../gateway/stop-route.mjs";

/** What a stop mount looks like in source. */
const MOUNT_MARKERS = ["handleStopAll", "isStopPath", "/sessions/stop-all"];

export function stopRouteMounted(src = "") {
  return MOUNT_MARKERS.some((m) => src.includes(m));
}

/** `import { a, b } from "./routes/x.mjs"` → [{ rel, names }]. */
function routeImports(dispatcher) {
  const out = [];
  const re = /import\s*\{([^}]*)\}\s*from\s*["']\.\/(routes\/[\w.\-/]+\.mjs)["']/g;
  for (const m of dispatcher.matchAll(re)) {
    const names = m[1]
      .split(",")
      .map((s) => s.trim().split(/\s+as\s+/).pop().trim())
      .filter(Boolean);
    out.push({ rel: m[2], names });
  }
  return out;
}

/**
 * Decide whether the gateway dispatcher actually reaches a stop handler.
 *
 * Requires a CHAIN, not a filename: the dispatcher carries the markers itself,
 * or it imports a route module that carries them AND calls what it imported.
 * A stop module left orphaned by a refactor — present, exporting, wired to
 * nothing — is not a mount, and must not read as one.
 *
 * @param {Record<string,string>|Map<string,string>} sources
 *   Gateway sources keyed by path relative to `src/gateway/`
 *   ("index.mjs", "routes/stop.mjs", …).
 * @returns {{mounted: true|false|null, via: string|null, reason: string}}
 *   `mounted: null` means "could not tell" — never "fine".
 */
export function analyzeStopMount(sources = {}) {
  const get = (k) => (sources instanceof Map ? sources.get(k) : sources[k]);
  const dispatcher = get("index.mjs");
  if (typeof dispatcher !== "string" || !dispatcher) {
    return { mounted: null, via: null, reason: "gateway dispatcher source unreadable" };
  }
  if (stopRouteMounted(dispatcher)) {
    return { mounted: true, via: "index.mjs", reason: "mounted inline in the dispatcher" };
  }
  const imports = routeImports(dispatcher);
  for (const { rel, names } of imports) {
    const src = get(rel);
    if (typeof src !== "string" || !stopRouteMounted(src)) continue;
    // Imported is not mounted: the dispatcher has to call the handler too.
    const called = names.some(
      (n) => new RegExp(`\\b${n}\\s*\\(`).test(dispatcher)
    );
    if (called) {
      return { mounted: true, via: rel, reason: "dispatcher imports and calls the stop route module" };
    }
  }
  return {
    mounted: false,
    via: null,
    reason: imports.length
      ? "no route module the dispatcher calls handles /stop"
      : "no stop markers in the dispatcher",
  };
}

/** Read `src/gateway/index.mjs` + `src/gateway/routes/*.mjs`, or null. */
export async function readGatewaySources() {
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    // Module-relative, NOT cwd-relative: doctor is run from wherever the
    // operator happens to stand, and the old cwd path silently checked nothing.
    const dir = fileURLToPath(new URL("../gateway/", import.meta.url));
    const out = {};
    out["index.mjs"] = fs.readFileSync(path.join(dir, "index.mjs"), "utf8");
    const routesDir = path.join(dir, "routes");
    for (const f of fs.readdirSync(routesDir)) {
      if (f.endsWith(".mjs")) out[`routes/${f}`] = fs.readFileSync(path.join(routesDir, f), "utf8");
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * What the row should say. Pure, so every outcome is directly testable —
 * including the one the old code could not express: "I did not find out".
 *
 * @returns {{status: "ok"|"warn"|"error", message: string}}
 */
export function describeStopMount(helperOk, mount = {}) {
  if (!helperOk) return { status: "error", message: "POST /stop helper missing" };
  if (mount.mounted === true) {
    return { status: "ok", message: `POST /stop helper + gateway mount wired via ${mount.via}` };
  }
  if (mount.mounted === false) {
    return {
      status: "warn",
      message: "POST /stop helper present; gateway mount not detected (apply stop-route wire)",
    };
  }
  // Unknown. Never ok — the old default said "markers present" about a file it
  // had never opened.
  return {
    status: "warn",
    message: `POST /stop helper present; gateway mount NOT verified (${mount.reason || "unknown"}) — see gateway.stopProbe`,
  };
}

export async function pushStopRouteChecks(push, cfg = {}) {
  let helperOk = false;
  try {
    const mod = await import("../gateway/stop-route.mjs");
    helperOk = typeof mod.handleStopAll === "function" && typeof mod.isStopPath === "function";
    if (helperOk && !isStopPath("/stop")) helperOk = false;
  } catch (e) {
    push("gateway.stopRoute", "warn", e.message || String(e), { helperOk: false });
    return { helperOk: false };
  }

  const sources = await readGatewaySources();
  const mount = sources
    ? analyzeStopMount(sources)
    : { mounted: null, via: null, reason: "gateway sources unreadable" };
  const mounted = mount.mounted;
  const { status, message } = describeStopMount(helperOk, mount);

  push("gateway.stopRoute", status, message, {
    helperOk,
    mounted,
    via: mount.via,
    paths: ["/stop", "/xclaw/stop", "/sessions/stop-all"],
  });
  return { helperOk, mounted, via: mount.via };
}

export default {
  pushStopRouteChecks,
  stopRouteMounted,
  analyzeStopMount,
  describeStopMount,
  readGatewaySources,
};
