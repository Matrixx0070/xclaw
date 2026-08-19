/**
 * Horizon 4 — Session Physics + Swarm fabric
 *
 * - Tab leases: exclusive ownership so agents cannot stomp each other
 * - Commit gates: irreversible actions require critic OK / explicit commit
 * - Role capabilities: observer | actor | critic (motor permissions)
 * - Logical clock: ordering for "after X then Y" without wall-clock races
 *
 * Persistence: ~/.xclaw/fabric/ (or XCLAW_FABRIC_DIR)
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { withFabricLock } from "./fabric-lock.mjs";

const ROLE_CAPS = {
  observer: { motor: false, navigate: false, read: true, networkAssert: true },
  actor: { motor: true, navigate: true, read: true, networkAssert: true },
  critic: { motor: false, navigate: false, read: true, networkAssert: true },
  planner: { motor: false, navigate: false, read: true, networkAssert: false },
};

/** Actions that require a commit gate by default */
const DEFAULT_COMMIT_PATTERNS = [
  /checkout/i,
  /\/pay\b/i,
  /\/payment/i,
  /\/purchase/i,
  /\/order\/confirm/i,
  /\/submit/i,
  /\/delete/i,
  /\/destroy/i,
  /\/transfer/i,
  /\/wire/i,
  /\/send.*message/i,
  /\/account\/delete/i,
];

function fabricRoot() {
  return (
    process.env.XCLAW_FABRIC_DIR ||
    path.join(os.homedir(), ".xclaw", "fabric")
  );
}

async function ensureFabric() {
  const root = fabricRoot();
  await fs.mkdir(root, { recursive: true });
  return root;
}

function leasesPath() {
  return path.join(fabricRoot(), "tab-leases.json");
}

function gatesPath() {
  return path.join(fabricRoot(), "commit-gates.json");
}

function clockPath() {
  return path.join(fabricRoot(), "clock.json");
}

async function readJson(p, fallback) {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(p, data) {
  await ensureFabric();
  // Two concurrent writers in the SAME process produced the same tmp name, so
  // one rename won and the other hit ENOENT ("parallel acquires on different
  // tabs"). Name every temp file uniquely per call.
  const tmp = p + ".tmp." + process.pid + "." + Date.now() + "." + Math.random().toString(16).slice(2);
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n");
  await fs.rename(tmp, p);
}

/** A8: exclusive RMW under fabric lock */
async function lockedJsonUpdate(p, fallback, mutator) {
  return withFabricLock(async () => {
    const cur = await readJson(p, fallback);
    const next = await mutator(cur);
    if (next !== undefined) await writeJsonAtomic(p, next);
    return next;
  }, { name: "fabric" });
}

/**
 * Logical clock tick (monotonic per fabric).
 */
async function tickClockUnlocked(label = "") {
  await ensureFabric();
  const cur = await readJson(clockPath(), { n: 0, events: [] });
  cur.n = Number(cur.n || 0) + 1;
  cur.events = Array.isArray(cur.events) ? cur.events : [];
  cur.events.push({
    n: cur.n,
    ts: Date.now(),
    label: label || undefined,
  });
  if (cur.events.length > 500) cur.events = cur.events.slice(-500);
  await writeJsonAtomic(clockPath(), cur);
  return cur.n;
}

export async function tickClock(label = "") {
  return withFabricLock(() => tickClockUnlocked(label));
}

export async function readClock() {
  return readJson(clockPath(), { n: 0, events: [] });
}

/**
 * Role capability check.
 */
export function roleCaps(role = "actor") {
  return ROLE_CAPS[role] || ROLE_CAPS.actor;
}

export function assertMotorAllowed(role, action = "motor") {
  const caps = roleCaps(role);
  if (action === "navigate" && !caps.navigate) {
    return {
      ok: false,
      code: "ROLE_NO_NAVIGATE",
      reason: `role=${role} cannot navigate`,
    };
  }
  if ((action === "motor" || action === "click" || action === "type") && !caps.motor) {
    return {
      ok: false,
      code: "ROLE_NO_MOTOR",
      reason: `role=${role} cannot use motor (click/type/scroll)`,
    };
  }
  return { ok: true, caps };
}

/**
 * Acquire exclusive lease on a tab.
 * @param {string} tabId
 * @param {{ agentId: string, role?: string, ttlMs?: number }} opts
 */
export async function acquireTabLease(tabId, opts = {}) {
  const id = String(tabId || "").trim();
  if (!id) return { ok: false, code: "TAB_REQUIRED", reason: "tabId required" };
  const agentId = String(opts.agentId || process.env.XCLAW_AGENT_ID || `agent_${process.pid}`);
  const role = opts.role || process.env.XCLAW_AGENT_ROLE || "actor";
  const caps = roleCaps(role);
  if (!caps.motor && !opts.allowReadLease) {
    return { ok: false, code: "ROLE_NO_LEASE", reason: `role=${role} cannot hold exclusive motor lease` };
  }
  const ttlMs = Number(opts.ttlMs || process.env.XCLAW_TAB_LEASE_TTL_MS || 120_000);
  const now = Date.now();

  return withFabricLock(async () => {
    const store = await readJson(leasesPath(), { leases: {} });
    store.leases = store.leases || {};
    for (const [k, v] of Object.entries(store.leases)) {
      if (v.expiresAt && v.expiresAt < now) delete store.leases[k];
    }
    const existing = store.leases[id];
    if (existing && existing.agentId !== agentId && existing.expiresAt > now) {
      return {
        ok: false,
        code: "TAB_LEASE_HELD",
        reason: `tab ${id} leased by ${existing.agentId} until ${new Date(existing.expiresAt).toISOString()}`,
        holder: existing,
      };
    }
    const lease = {
      tabId: id,
      agentId,
      role,
      acquiredAt: existing?.agentId === agentId ? existing.acquiredAt : now,
      expiresAt: now + ttlMs,
      renewedAt: now,
      heartbeatCount: (existing?.agentId === agentId ? Number(existing.heartbeatCount || 0) : 0),
      clock: null,
    };
    const n = await tickClockUnlocked(`lease:${id}:${agentId}`);
    lease.clock = n;
    store.leases[id] = lease;
    await writeJsonAtomic(leasesPath(), store);
    return { ok: true, lease };
  });
}

export async function releaseTabLease(tabId, opts = {}) {
  const id = String(tabId || "").trim();
  const agentId = String(opts.agentId || process.env.XCLAW_AGENT_ID || "");
  return withFabricLock(async () => {
    const store = await readJson(leasesPath(), { leases: {} });
    const existing = store.leases?.[id];
    if (!existing) return { ok: true, released: false, reason: "not_held" };
    if (agentId && existing.agentId !== agentId && !opts.force) {
      return {
        ok: false,
        code: "TAB_LEASE_HELD",
        reason: `held by ${existing.agentId}`,
        holder: existing,
      };
    }
    delete store.leases[id];
    await writeJsonAtomic(leasesPath(), store);
    await tickClockUnlocked(`release:${id}`);
    return { ok: true, released: true };
  });
}


/**
 * A8 — Heartbeat: extend lease TTL (holder only).
 */
export async function renewTabLease(tabId, opts = {}) {
  const id = String(tabId || "").trim();
  if (!id) return { ok: false, code: "TAB_REQUIRED" };
  const agentId = String(opts.agentId || process.env.XCLAW_AGENT_ID || `agent_${process.pid}`);
  const ttlMs = Number(opts.ttlMs || process.env.XCLAW_TAB_LEASE_TTL_MS || 120_000);
  const now = Date.now();

  return withFabricLock(async () => {
    const store = await readJson(leasesPath(), { leases: {} });
    store.leases = store.leases || {};
    const existing = store.leases[id];
    if (!existing) {
      return { ok: false, code: "TAB_LEASE_MISSING", reason: `no lease on ${id}` };
    }
    if (existing.agentId !== agentId && !opts.force) {
      return {
        ok: false,
        code: "TAB_LEASE_HELD",
        reason: `held by ${existing.agentId}`,
        holder: existing,
      };
    }
    if (existing.expiresAt < now && existing.agentId !== agentId) {
      return { ok: false, code: "TAB_LEASE_EXPIRED", reason: "lease expired" };
    }
    existing.expiresAt = now + ttlMs;
    existing.renewedAt = now;
    existing.heartbeatCount = Number(existing.heartbeatCount || 0) + 1;
    existing.clock = await tickClockUnlocked(`renew:${id}:${agentId}`);
    store.leases[id] = existing;
    await writeJsonAtomic(leasesPath(), store);
    return { ok: true, lease: existing };
  });
}

export async function requireTabLease(tabId, opts = {}) {
  const agentId = opts.agentId || process.env.XCLAW_AGENT_ID || `agent_${process.pid}`;
  const role = opts.role || "actor";
  const caps = assertMotorAllowed(role, opts.action || "motor");
  if (!caps.ok) return caps;

  const store = await readJson(leasesPath(), { leases: {} });
  const now = Date.now();
  const id = String(tabId || "").trim();
  if (!id) {
    // no tab id — allow but warn (some tools open new tabs)
    return { ok: true, warning: "no_tabId", caps: caps.caps };
  }
  const existing = store.leases?.[id];
  if (!existing || existing.expiresAt < now) {
    if (opts.autoAcquire) {
      return acquireTabLease(id, { agentId, role, ttlMs: opts.ttlMs });
    }
    return {
      ok: false,
      code: "TAB_LEASE_MISSING",
      reason: `no lease on tab ${id} — call tab_lease acquire first`,
    };
  }
  if (existing.agentId !== agentId) {
    return {
      ok: false,
      code: "TAB_LEASE_HELD",
      reason: `tab ${id} owned by ${existing.agentId}`,
      holder: existing,
    };
  }
  return { ok: true, lease: existing, caps: caps.caps };
}

export async function listTabLeases() {
  const store = await readJson(leasesPath(), { leases: {} });
  const now = Date.now();
  const out = [];
  for (const [k, v] of Object.entries(store.leases || {})) {
    if (v.expiresAt < now) continue;
    out.push(v);
  }
  return out;
}

/**
 * Does URL/path look irreversible?
 */
export function isCommitSensitive(urlOrPath = "", extraPatterns = []) {
  const s = String(urlOrPath || "");
  const patterns = [
    ...DEFAULT_COMMIT_PATTERNS,
    ...(extraPatterns || []).map((p) =>
      p instanceof RegExp ? p : new RegExp(String(p), "i")
    ),
  ];
  return patterns.some((re) => re.test(s));
}

/**
 * Open a commit gate — irreversible action pending approval.
 */
export async function openCommitGate(opts = {}) {
  const id = opts.id || `gate_${Date.now().toString(36)}_${crypto.randomBytes(2).toString("hex")}`;
  return withFabricLock(async () => {
    const gate = {
      id,
      status: "pending",
      action: opts.action || "unknown",
      url: opts.url,
      tabId: opts.tabId,
      agentId: opts.agentId || process.env.XCLAW_AGENT_ID || `agent_${process.pid}`,
      reason: opts.reason || "commit-sensitive action",
      requireCritic: opts.requireCritic !== false,
      criticOk: false,
      createdAt: Date.now(),
      expiresAt: Date.now() + (Number(opts.ttlMs) || 600_000),
      clock: await tickClockUnlocked(`gate-open:${id}`),
    };
    const store = await readJson(gatesPath(), { gates: {} });
    store.gates = store.gates || {};
    store.gates[id] = gate;
    await writeJsonAtomic(gatesPath(), store);
    return { ok: true, gate };
  });
}

/**
 * Critic or operator approves/rejects a gate.
 */
export async function resolveCommitGate(gateId, decision, opts = {}) {
  return withFabricLock(async () => {
    const store = await readJson(gatesPath(), { gates: {} });
    const gate = store.gates?.[gateId];
    if (!gate) return { ok: false, code: "GATE_NOT_FOUND", reason: `no gate ${gateId}` };
    if (gate.status !== "pending") {
      return { ok: false, code: "GATE_NOT_PENDING", reason: `status=${gate.status}`, gate };
    }
    if (gate.expiresAt < Date.now()) {
      gate.status = "expired";
      store.gates[gateId] = gate;
      await writeJsonAtomic(gatesPath(), store);
      return { ok: false, code: "GATE_EXPIRED", gate };
    }

    const role = opts.role || "critic";
    if (decision === "approve") {
      if (gate.requireCritic && role !== "critic" && role !== "operator" && !opts.force) {
        return {
          ok: false,
          code: "CRITIC_REQUIRED",
          reason: "commit gate requires critic/operator approval",
          gate,
        };
      }
      gate.status = "approved";
      gate.criticOk = true;
      gate.resolvedBy = opts.agentId || process.env.XCLAW_AGENT_ID || role;
      gate.resolvedAt = Date.now();
      gate.clock = await tickClockUnlocked(`gate-approve:${gateId}`);
    } else if (decision === "reject") {
      gate.status = "rejected";
      gate.resolvedBy = opts.agentId || process.env.XCLAW_AGENT_ID || role;
      gate.resolvedAt = Date.now();
      gate.clock = await tickClockUnlocked(`gate-reject:${gateId}`);
    } else {
      return { ok: false, code: "BAD_DECISION", reason: "decision must be approve|reject" };
    }
    store.gates[gateId] = gate;
    await writeJsonAtomic(gatesPath(), store);
    return { ok: true, gate };
  });
}

export async function requireCommitGate(urlOrPath, opts = {}) {
  const enabled =
    process.env.XCLAW_COMMIT_GATES === "1" ||
    process.env.XCLAW_COMMIT_GATES === "true" ||
    opts.forceCheck;
  if (!enabled) return { ok: true, skipped: true };

  if (!isCommitSensitive(urlOrPath, opts.extraPatterns)) {
    return { ok: true, sensitive: false };
  }

  const store = await readJson(gatesPath(), { gates: {} });
  const now = Date.now();
  // find matching approved gate
  for (const g of Object.values(store.gates || {})) {
    if (g.status !== "approved") continue;
    if (g.expiresAt < now) continue;
    if (opts.tabId && g.tabId && g.tabId !== opts.tabId) continue;
    if (g.url && urlOrPath && !String(urlOrPath).includes(String(g.url)) && !String(g.url).includes(String(urlOrPath))) {
      continue;
    }
    return { ok: true, sensitive: true, gate: g };
  }

  // auto-open pending gate for agent to resolve
  const opened = await openCommitGate({
    action: opts.action || "navigate",
    url: urlOrPath,
    tabId: opts.tabId,
    agentId: opts.agentId,
    reason: opts.reason || `commit-sensitive: ${String(urlOrPath).slice(0, 120)}`,
  });
  return {
    ok: false,
    code: "COMMIT_GATE_REQUIRED",
    reason: "irreversible action requires approved commit gate",
    gate: opened.gate,
    sensitive: true,
  };
}

export async function listCommitGates(opts = {}) {
  const store = await readJson(gatesPath(), { gates: {} });
  let gates = Object.values(store.gates || {});
  if (opts.status) gates = gates.filter((g) => g.status === opts.status);
  return gates.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/**
 * Fabric status snapshot for agents / doctor.
 */
export async function fabricStatus() {
  const leases = await listTabLeases();
  const gates = await listCommitGates();
  const clock = await readClock();
  return {
    fabricDir: fabricRoot(),
    clock: clock.n || 0,
    leases: leases.length,
    leaseDetails: leases,
    gatesPending: gates.filter((g) => g.status === "pending").length,
    gatesApproved: gates.filter((g) => g.status === "approved").length,
    roles: Object.keys(ROLE_CAPS),
    commitGatesEnabled:
      process.env.XCLAW_COMMIT_GATES === "1" || process.env.XCLAW_COMMIT_GATES === "true",
  };
}

export default {
  tickClock,
  readClock,
  roleCaps,
  assertMotorAllowed,
  acquireTabLease,
  releaseTabLease,
  requireTabLease,
  listTabLeases,
  isCommitSensitive,
  openCommitGate,
  resolveCommitGate,
  requireCommitGate,
  listCommitGates,
  fabricStatus,
  ROLE_CAPS,
};
