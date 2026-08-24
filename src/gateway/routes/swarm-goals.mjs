/**
 * Gateway routes for the swarm DECOMPOSE engine (ADR 0004 — unification).
 *
 * One /swarm surface for both engines: the native ensemble keeps
 * /swarm/run · /swarm/run/stream · /swarm/merges (inline in index.mjs);
 * the decompose engine (goal → DAG → parallel sub-agents with real tools →
 * merge → receipt) lives here:
 *
 *   POST /swarm/goals            — submit a goal
 *   GET  /swarm/tasks/:id        — task status/result/receipt
 *   POST /swarm/tasks/:id/cancel
 *   GET  /swarm/decompose/health|stats|sessions
 *
 * /api/swarm/* aliases from the pre-unification module are kept working.
 * Feature flag: cfg.swarm.decompose.enabled (legacy alias cfg.swarmExt.enabled)
 * — OFF by default; disabled → 404 typed, engine never imported.
 */

function normalize(p) {
  if (p === "/api/swarm" || p.startsWith("/api/swarm/")) {
    const rest = p.slice("/api/swarm".length) || "/";
    // legacy /api/swarm/health|stats|sessions → /swarm/decompose/*
    if (rest === "/health" || rest === "/stats" || rest === "/sessions") {
      return `/swarm/decompose${rest}`;
    }
    return `/swarm${rest === "/" ? "" : rest}`;
  }
  return p;
}

const DECOMPOSE_RE = /^\/swarm\/(goals$|tasks\/|decompose\/)/;

export function isSwarmDecomposePath(p) {
  return DECOMPOSE_RE.test(normalize(p)) || p === "/api/swarm" || p.startsWith("/api/swarm/");
}

/** @returns {Promise<boolean>} true if handled */
export async function tryHandleSwarmGoalsRoute({ p, method, req, res, url, cfg, json, readBody }) {
  if (!isSwarmDecomposePath(p)) return false;
  const np = normalize(p);

  const enabled = cfg?.swarm?.decompose?.enabled ?? cfg?.swarmExt?.enabled ?? false;
  if (!enabled) {
    json(res, 404, {
      error: "swarm decompose engine disabled",
      code: "SWARM_DECOMPOSE_DISABLED",
      hint: "set swarm.decompose.enabled=true in xclaw config",
    });
    return true;
  }

  let rt;
  try {
    rt = await import("../../swarm/runtime.mjs");
  } catch (err) {
    json(res, 503, { error: `swarm runtime unavailable: ${err.message}`, code: "SWARM_RUNTIME_UNAVAILABLE" });
    return true;
  }

  try {
    if (np === "/swarm/goals" && method === "POST") {
      const body = await readBody(req).catch(() => ({}));
      const out = await rt.submitGoal(cfg, body);
      json(res, out.status, out.body);
      return true;
    }
    let m = np.match(/^\/swarm\/tasks\/([^/]+)\/cancel$/);
    if (m && method === "POST") {
      const out = await rt.cancelTask(cfg, m[1], url.searchParams.get("sessionId") || "default");
      json(res, out.status, out.body);
      return true;
    }
    m = np.match(/^\/swarm\/tasks\/([^/]+)$/);
    if (m && method === "GET") {
      const out = await rt.getTaskView(cfg, m[1], url.searchParams.get("sessionId") || "default");
      json(res, out.status, out.body);
      return true;
    }
    if (np === "/swarm/decompose/health" && method === "GET") {
      const out = await rt.decomposeHealth(cfg);
      json(res, out.status, out.body);
      return true;
    }
    if (np === "/swarm/decompose/stats" && method === "GET") {
      const out = await rt.decomposeStats(cfg);
      json(res, out.status, out.body);
      return true;
    }
    if (np === "/swarm/decompose/sessions" && method === "GET") {
      const out = await rt.decomposeSessions(cfg);
      json(res, out.status, out.body);
      return true;
    }
    // an /api/swarm/* path that maps to nothing above (e.g. the removed
    // fake /batch endpoint) — typed 404 rather than falling through
    if (p === "/api/swarm" || p.startsWith("/api/swarm/")) {
      json(res, 404, { error: "unknown swarm route", path: np });
      return true;
    }
  } catch (err) {
    json(res, 500, { error: err.message || String(err) });
    return true;
  }
  return false;
}

export default { tryHandleSwarmGoalsRoute, isSwarmDecomposePath };
