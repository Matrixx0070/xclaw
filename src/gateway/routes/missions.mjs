/**
 * Mission Control routes — autonomous engineering missions.
 *
 * Paths:
 *   GET    /missions                — list (id, goal, status, progress)
 *   POST   /missions                — {goal, repoDir, autoMerge?, maxAttempts?, verify?}
 *   GET    /missions/:id            — full record (plan, verify evidence, events)
 *   GET    /missions/:id/diff       — the patch
 *   POST   /missions/:id/resume     — resume interrupted/failed
 *   POST   /missions/:id/merge      — {checkOnly?} apply verified changes (gated step)
 *   POST   /missions/:id/rollback   — discard worktree (repo untouched)
 */
import { broadcast as wsBroadcast } from "../ws-hub.mjs";

function missionSummary(m) {
  return {
    id: m.id,
    goal: m.goal,
    repoDir: m.repoDir,
    status: m.status,
    attempts: m.attempts,
    maxAttempts: m.maxAttempts,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    lastEvent: m.events?.at(-1) || null,
    verified: Boolean(m.verify?.history?.at(-1)?.ok),
    hasDiff: Boolean(m.diff?.patch),
    strategy: m.strategy || "solo",
    swarm: m.swarm
      ? {
          runId: m.swarm.runId || null,
          tasks: (m.swarm.tasks || []).length,
          nodesOk: (m.swarm.nodes || []).filter((n) => n.ok).length,
          nodes: (m.swarm.nodes || []).length,
        }
      : null,
  };
}

const emitWs = (e) => {
  try {
    wsBroadcast("mission", e);
  } catch {}
};

/** @returns {Promise<boolean>} true if handled */
export async function tryHandleMissionsRoute({ p, method, req, res, url, cfg, json, readBody }) {
  if (!p.startsWith("/missions")) return false;
  const store = await import("../../missions/store.mjs");
  const engine = await import("../../missions/engine.mjs");

  if (p === "/missions" && method === "GET") {
    const list = await store.listMissions(cfg, {
      limit: Number(url.searchParams.get("limit") || 50),
      status: url.searchParams.get("status") || undefined,
    });
    json(res, 200, {
      missions: list.map((m) => ({ ...missionSummary(m), running: engine.missionRunning(m.id) })),
    });
    return true;
  }
  if (p === "/missions" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    try {
      const mission = await engine.startMission(cfg, {
        goal: body.goal,
        repoDir: body.repoDir,
        autoMerge: body.autoMerge === true,
        maxAttempts: body.maxAttempts,
        verify: Array.isArray(body.verify) ? body.verify : null,
        strategy: body.strategy === "swarm" ? "swarm" : undefined,
        tasks: Array.isArray(body.tasks) ? body.tasks : undefined,
        onEvent: emitWs,
      });
      json(res, 200, { ok: true, mission: missionSummary(mission) });
    } catch (e) {
      json(res, 400, { ok: false, error: e.message });
    }
    return true;
  }

  const m = p.match(/^\/missions\/([^/]+)(?:\/([a-z]+))?$/);
  if (!m) return false;
  const id = decodeURIComponent(m[1]);
  const action = m[2] || null;

  if (!action && method === "GET") {
    const mission = await store.loadMission(cfg, id);
    if (!mission) {
      json(res, 404, { error: "mission not found" });
      return true;
    }
    const { diff, ...rest } = mission;
    json(res, 200, {
      ...rest,
      running: engine.missionRunning(id),
      diff: diff
        ? {
            stat: diff.stat,
            untracked: diff.untracked || [],
            excludedUntracked: diff.excludedUntracked || [],
            patchChars: (diff.patch || "").length,
          }
        : null,
    });
    return true;
  }
  if (action === "diff" && method === "GET") {
    const mission = await store.loadMission(cfg, id);
    if (!mission) {
      json(res, 404, { error: "mission not found" });
      return true;
    }
    json(res, 200, {
      id,
      stat: mission.diff?.stat || null,
      patch: mission.diff?.patch || "",
      untracked: mission.diff?.untracked || [],
      excludedUntracked: mission.diff?.excludedUntracked || [],
    });
    return true;
  }
  if (action === "resume" && method === "POST") {
    try {
      const mission = await engine.resumeMission(cfg, id, { onEvent: emitWs });
      json(res, 200, { ok: true, mission: missionSummary(mission) });
    } catch (e) {
      json(res, 400, { ok: false, error: e.message });
    }
    return true;
  }
  if (action === "merge" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    try {
      const out = await engine.mergeMission(cfg, id, {
        checkOnly: body.checkOnly === true,
        onEvent: emitWs,
      });
      json(res, 200, { ok: out.merge?.ok !== false, mission: missionSummary(out.mission), merge: out.merge });
    } catch (e) {
      json(res, 400, { ok: false, error: e.message });
    }
    return true;
  }
  if (action === "rollback" && method === "POST") {
    try {
      const mission = await engine.rollbackMission(cfg, id);
      emitWs({ missionId: id, type: "mission", phase: "rolled_back" });
      json(res, 200, { ok: true, mission: missionSummary(mission) });
    } catch (e) {
      json(res, 400, { ok: false, error: e.message });
    }
    return true;
  }
  return false;
}

export default { tryHandleMissionsRoute };
