/**
 * A7 — Role binding (session-scoped, not free-for-all env)
 *
 * Priority (highest first):
 *   1. Explicit bindRole(sessionId, role) registry
 *   2. ctx.role when ctx.roleTrusted === true (gateway/swarm set it)
 *   3. XCLAW_AGENT_ROLE only if XCLAW_ROLE_FROM_ENV=1 (lab)
 *   4. Default "actor"
 *
 * Under XCLAW_FABRIC_ENFORCE / prod strict, env role is ignored unless
 * XCLAW_ROLE_FROM_ENV=1 was explicitly set (still warn via doctor).
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { withFabricLock } from "./fabric-lock.mjs";

const VALID = new Set(["observer", "actor", "critic", "planner"]);

/** @type {Map<string, { role: string, boundAt: number, source: string }>} */
const memory = new Map();

function fabricDir() {
  return process.env.XCLAW_FABRIC_DIR || path.join(os.homedir(), ".xclaw", "fabric");
}

function rolesPath() {
  return path.join(fabricDir(), "session-roles.json");
}

export function normalizeRole(role) {
  const r = String(role || "").toLowerCase().trim();
  if (VALID.has(r)) return r;
  return null;
}

export async function bindRole(sessionId, role, opts = {}) {
  const id = String(sessionId || "").trim();
  if (!id) return { ok: false, code: "SESSION_REQUIRED" };
  const r = normalizeRole(role);
  if (!r) return { ok: false, code: "BAD_ROLE", reason: `role must be one of ${[...VALID].join(",")}` };
  const rec = {
    role: r,
    boundAt: Date.now(),
    source: opts.source || "bind",
  };
  memory.set(id, rec);
  try {
    await withFabricLock(async () => {
      await fs.mkdir(fabricDir(), { recursive: true });
      let all = {};
      try {
        all = JSON.parse(await fs.readFile(rolesPath(), "utf8"));
      } catch {
        all = {};
      }
      all[id] = rec;
      const tmp = rolesPath() + ".tmp." + process.pid;
      await fs.writeFile(tmp, JSON.stringify(all, null, 2) + "\n");
      await fs.rename(tmp, rolesPath());
    }, { name: "roles" });
  } catch {
    /* memory still valid */
  }
  return { ok: true, sessionId: id, ...rec };
}

export async function unbindRole(sessionId) {
  const id = String(sessionId || "").trim();
  memory.delete(id);
  try {
    const all = JSON.parse(await fs.readFile(rolesPath(), "utf8"));
    delete all[id];
    await fs.writeFile(rolesPath(), JSON.stringify(all, null, 2) + "\n");
  } catch {
    /* */
  }
  return { ok: true };
}

export async function getBoundRole(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return null;
  if (memory.has(id)) return memory.get(id);
  try {
    const all = JSON.parse(await fs.readFile(rolesPath(), "utf8"));
    if (all[id]?.role) {
      memory.set(id, all[id]);
      return all[id];
    }
  } catch {
    /* */
  }
  return null;
}

function strictMode() {
  return (
    process.env.XCLAW_FABRIC_ENFORCE === "1" ||
    process.env.XCLAW_FABRIC_ENFORCE === "true" ||
    process.env.XCLAW_ENFORCEMENT_STRICT === "1" ||
    process.env.XCLAW_PROFILE === "prod"
  );
}

function allowEnvRole() {
  return (
    process.env.XCLAW_ROLE_FROM_ENV === "1" ||
    process.env.XCLAW_ROLE_FROM_ENV === "true"
  );
}

/**
 * Resolve effective role for an actuation.
 * @param {object} ctx
 * @returns {Promise<{ role: string, source: string, trusted: boolean }>}
 */
export async function resolveRole(ctx = {}) {
  const sessionId = ctx.sessionId || ctx.agentId || process.env.XCLAW_AGENT_ID;

  if (sessionId) {
    const bound = await getBoundRole(sessionId);
    if (bound?.role) {
      return { role: bound.role, source: "session_bind", trusted: true };
    }
  }

  if (ctx.roleTrusted && ctx.role) {
    const r = normalizeRole(ctx.role);
    if (r) return { role: r, source: "trusted_ctx", trusted: true };
  }

  // Swarm/gateway may pass role with trusted flag in future
  if (ctx.role && ctx.source === "swarm") {
    const r = normalizeRole(ctx.role);
    if (r) return { role: r, source: "swarm", trusted: true };
  }

  // Explicit ctx.role wins over env when not in strict mode (tests / lab calls)
  if (ctx.role && !strictMode()) {
    const r = normalizeRole(ctx.role);
    if (r) return { role: r, source: "ctx", trusted: false };
  }

  if (allowEnvRole() || !strictMode()) {
    const envRole = normalizeRole(process.env.XCLAW_AGENT_ROLE);
    if (envRole) {
      return {
        role: envRole,
        source: "env",
        trusted: allowEnvRole(),
      };
    }
  }

  // Strict mode without bind → default observer (fail closed for motor)
  if (strictMode() && !allowEnvRole()) {
    return { role: "observer", source: "strict_default", trusted: true };
  }

  return { role: "actor", source: "default", trusted: false };
}

export const VALID_ROLES = [...VALID];


/**
 * Map swarm graph roles → fabric motor roles (C2).
 * research/verify → observer (read); implement/actor → actor; critic → critic.
 */
export function mapSwarmRoleToFabric(swarmRole) {
  const r = String(swarmRole || "").toLowerCase().trim();
  const map = {
    actor: "actor",
    observer: "observer",
    critic: "critic",
    planner: "planner",
    implement: "actor",
    research: "observer",
    verify: "observer",
    task: "actor",
  };
  return map[r] || null;
}

/**
 * Bind fabric role at swarm/subagent spawn (trusted).
 * Binds both spawn id and optional session id.
 */
export async function bindSwarmSpawnRole(opts = {}) {
  const fabricRole =
    normalizeRole(opts.fabricRole) || mapSwarmRoleToFabric(opts.swarmRole || opts.role);
  if (!fabricRole) {
    return { ok: false, code: "NO_ROLE_MAP", reason: "could not map swarm role to fabric role" };
  }
  const ids = [opts.spawnId, opts.sessionId, opts.agentId].filter(Boolean);
  const bound = [];
  for (const id of ids) {
    const r = await bindRole(String(id), fabricRole, {
      source: opts.source || "swarm",
    });
    if (r.ok) bound.push({ id, role: fabricRole });
  }
  return { ok: bound.length > 0, fabricRole, bound, source: "swarm" };
}

export default {
  bindRole,
  unbindRole,
  getBoundRole,
  resolveRole,
  normalizeRole,
  mapSwarmRoleToFabric,
  bindSwarmSpawnRole,
  VALID_ROLES,
};
