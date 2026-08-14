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

  // ── remote workers (mission federation) — handled BEFORE the :id regex so
  // "workers"/"remote" can never be parsed as mission ids
  if (p === "/missions/workers" && method === "GET") {
    const remote = await import("../../missions/remote.mjs");
    const workers = remote.listWorkers(cfg);
    const raw = Array.isArray(cfg.missions?.workers) ? cfg.missions.workers : [];
    const pings = await Promise.all(raw.filter((w) => w?.name && w?.url).map((w) => remote.pingWorker(w)));
    json(res, 200, {
      workers: workers.map((w) => ({ ...w, ping: pings.find((pi) => pi.name === w.name) || null })),
    });
    return true;
  }
  if (p === "/missions/workers" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    const remote = await import("../../missions/remote.mjs");
    const name = String(body.name || "").trim();
    if (!name || !/^[\w.-]{1,40}$/.test(name)) {
      json(res, 400, { ok: false, error: "worker name required ([\\w.-], ≤40)" });
      return true;
    }
    const v = remote.validateWorkerUrl(body.url, { allowInsecure: body.allowInsecure === true });
    if (!v.ok) {
      json(res, 400, { ok: false, error: v.error });
      return true;
    }
    const { saveConfigPatch } = await import("../../config/load.mjs");
    const existing = Array.isArray(cfg.missions?.workers) ? cfg.missions.workers : [];
    const next = existing.filter((w) => w?.name !== name);
    next.push({
      name,
      url: String(body.url),
      ...(body.token ? { token: String(body.token) } : {}),
      ...(body.allowInsecure === true ? { allowInsecure: true } : {}),
    });
    await saveConfigPatch({ missions: { ...(cfg.missions || {}), workers: next } });
    cfg.missions = { ...(cfg.missions || {}), workers: next };
    json(res, 200, { ok: true, workers: remote.listWorkers(cfg) });
    return true;
  }
  const delW = p.match(/^\/missions\/workers\/([\w.-]{1,40})$/);
  if (delW && method === "DELETE") {
    const remote = await import("../../missions/remote.mjs");
    const { saveConfigPatch } = await import("../../config/load.mjs");
    const existing = Array.isArray(cfg.missions?.workers) ? cfg.missions.workers : [];
    const next = existing.filter((w) => w?.name !== delW[1]);
    await saveConfigPatch({ missions: { ...(cfg.missions || {}), workers: next } });
    cfg.missions = { ...(cfg.missions || {}), workers: next };
    json(res, 200, { ok: true, workers: remote.listWorkers(cfg) });
    return true;
  }
  if (p === "/missions/remote" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    const remote = await import("../../missions/remote.mjs");
    const worker = remote.findWorker(cfg, body.worker);
    if (!worker) {
      json(res, 404, { ok: false, error: `unknown worker ${body.worker}` });
      return true;
    }
    try {
      const r = await remote.startRemoteMission(worker, {
        goal: body.goal,
        repoDir: body.repoDir,
        strategy: body.strategy,
        tasks: body.tasks,
        verify: body.verify,
        maxAttempts: body.maxAttempts,
      });
      json(res, 200, { ok: true, worker: worker.name, mission: r.mission || r });
    } catch (e) {
      json(res, 502, { ok: false, error: e.message });
    }
    return true;
  }
  const rm = p.match(/^\/missions\/remote\/([\w.-]{1,40})(?:\/([^/]+))?(?:\/(diff|merge|rollback))?$/);
  if (rm) {
    const remote = await import("../../missions/remote.mjs");
    const worker = remote.findWorker(cfg, rm[1]);
    if (!worker) {
      json(res, 404, { ok: false, error: `unknown worker ${rm[1]}` });
      return true;
    }
    try {
      if (!rm[2] && method === "GET") {
        const r = await remote.listRemoteMissions(worker, { limit: Number(url.searchParams.get("limit") || 25) });
        json(res, 200, { ok: true, worker: worker.name, ...r });
        return true;
      }
      const id = decodeURIComponent(rm[2] || "");
      if (rm[3] === "diff" && method === "GET") {
        json(res, 200, { ok: true, worker: worker.name, ...(await remote.getRemoteMissionDiff(worker, id)) });
        return true;
      }
      if (rm[3] === "merge" && method === "POST") {
        const body = await readBody(req).catch(() => ({}));
        json(res, 200, { ok: true, worker: worker.name, ...(await remote.mergeRemoteMission(worker, id, { checkOnly: body.checkOnly === true })) });
        return true;
      }
      if (rm[3] === "rollback" && method === "POST") {
        json(res, 200, { ok: true, worker: worker.name, ...(await remote.rollbackRemoteMission(worker, id)) });
        return true;
      }
      if (!rm[3] && method === "GET") {
        json(res, 200, { ok: true, worker: worker.name, mission: await remote.getRemoteMission(worker, id) });
        return true;
      }
    } catch (e) {
      json(res, 502, { ok: false, error: e.message });
      return true;
    }
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
