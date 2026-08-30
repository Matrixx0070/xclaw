/**
 * Subagent spawn — deepened with parent stream + registry.
 */
import { randomUUID } from "node:crypto";
import { runAgentLoop } from "../agent/loop.mjs";
import { createWorktree, removeWorktree, worktreeDiff, isGitRepo } from "./worktree.mjs";
import {
  saveSubagentSnapshot,
  reconcileStaleAgents,
} from "./swarm-store.mjs";

const registry = new Map();

/** S0 metrics */
export const subagentMetrics = {
  spawned: 0,
  completed: 0,
  errors: 0,
  timeouts: 0,
  running: () => [...registry.values()].filter((r) => r.status === "running").length,
};

let persistCfg = null;

/** Call once from gateway with cfg for durable snapshots */
export function configureSubagentPersistence(cfg) {
  persistCfg = cfg || null;
  // mark prior running agents as interrupted
  if (persistCfg) {
    void reconcileStaleAgents(
      persistCfg,
      new Set([...registry.keys()])
    ).catch(() => {});
  }
}

async function persist(record) {
  if (!persistCfg) return;
  try {
    await saveSubagentSnapshot(persistCfg, record);
  } catch (e) {
    console.warn("[xclaw:subagent] persist:", e.message);
  }
}

export function listSubagents({ parentId, status } = {}) {
  let all = [...registry.values()];
  if (parentId) all = all.filter((s) => s.parentId === parentId);
  if (status) all = all.filter((s) => s.status === status);
  return all.map(publicView);
}

export function getSubagent(id) {
  const r = registry.get(id);
  return r ? publicView(r) : null;
}

function publicView(r) {
  return {
    id: r.id,
    parentId: r.parentId,
    swarmId: r.swarmId || null,
    task: r.task,
    status: r.status,
    createdAt: r.createdAt,
    finishedAt: r.finishedAt,
    result: r.result,
    error: r.error,
    events: r.events?.length || 0,
    workspace: r.workspace || r.result?.workspace || null,
    isolated: r.isolated || r.result?.isolated || false,
    timeoutMs: r.timeoutMs || null,
  };
}

/**
 * Spawn child agent; streams events to parent onEvent with subagentId.
 */

/**
 * P1 — Prefer host workspace when the goal references absolute paths
 * outside a git worktree (e.g. /tmp/proof.txt). Opt-in via opts.hostWorkspace
 * or XCLAW_SWARM_HOST_WORKSPACE=1.
 */
export function shouldUseHostWorkspace(opts = {}, task = "") {
  if (opts.hostWorkspace === true) return true;
  if (opts.hostWorkspace === false) return false;
  if (
    process.env.XCLAW_SWARM_HOST_WORKSPACE === "1" ||
    process.env.XCLAW_SWARM_HOST_WORKSPACE === "true"
  ) {
    return true;
  }
  const text = String(task || opts.task || "");
  // Absolute unix paths that are not under typical repo roots
  const abs = text.match(/(?:^|\s|["'`])(\/(?:tmp|var\/tmp|home)\/[^\s"'`]+)/);
  return Boolean(abs);
}

export async function spawnSubagent(opts = {}) {
  // Depth guard: subagents inherit cfg.swarm._spawnDepth (set below for their
  // children). A chain deeper than swarm.maxSpawnDepth (default 2) is refused
  // with a structured result instead of a throw — stops recursive spawn loops.
  const spawnDepth = Number(opts.cfg?.swarm?._spawnDepth ?? 0) || 0;
  const maxSpawnDepth = Math.max(
    0,
    Number(opts.cfg?.swarm?.maxSpawnDepth ?? 2) || 2
  );
  if (spawnDepth >= maxSpawnDepth) {
    return {
      ok: false,
      code: "SPAWN_DEPTH_EXCEEDED",
      status: "refused",
      error: `spawn depth ${spawnDepth} >= swarm.maxSpawnDepth ${maxSpawnDepth} — flatten the task graph or raise the limit`,
      depth: spawnDepth,
      maxSpawnDepth,
    };
  }

  const id = randomUUID();
  const parentId = opts.parentId || null;
  const record = {
    id,
    parentId,
    task: opts.task,
    status: "running",
    createdAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    error: null,
    events: [],
  };
  const timeoutMs = Math.max(
    5_000,
    Number(
      opts.timeoutMs ??
        opts.cfg?.swarm?.subagentTimeoutMs ??
        opts.cfg?.agent?.subagentTimeoutMs ??
        300_000
    ) || 300_000
  );
  record.timeoutMs = timeoutMs;
  record.swarmId = opts.swarmId || null;
  registry.set(id, record);
  subagentMetrics.spawned += 1;
  void persist(record);

  // C2: trusted fabric role at spawn (before agent loop)
  let fabricRoleBind = null;
  if (opts.role || opts.fabricRole || opts.swarmRole) {
    try {
      const { bindSwarmSpawnRole } = await import("../browser/role-binding.mjs");
      fabricRoleBind = await bindSwarmSpawnRole({
        spawnId: id,
        agentId: id,
        swarmRole: opts.role || opts.swarmRole,
        fabricRole: opts.fabricRole,
        source: "swarm",
      });
      record.fabricRole = fabricRoleBind.fabricRole;
      record.roleBind = fabricRoleBind;
    } catch (e) {
      record.roleBindError = e.message || String(e);
    }
  }


  let isolatedDir = null;
  let worktree = null;
  let workingDir = opts.workingDir || process.cwd();
  const baseDir = opts.workingDir || process.cwd();

  if (opts.worktree) {
    const wt = await createWorktree(baseDir);
    if (!wt.ok) {
      // fall back to temp isolate
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const os = await import("node:os");
      isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-sub-"));
      workingDir = isolatedDir;
      record.worktreeError = wt.error;
    } else {
      worktree = wt;
      workingDir = wt.path;
      record.worktree = { path: wt.path, branch: wt.branch };
    }
  } else if (opts.isolateWorkspace) {
    // P1 host workspace: keep process cwd when goal uses absolute host paths
    // (e.g. /tmp/proof.txt) so verify/writes match owner paths.
    const taskText = opts.task || opts.goal || "";
    if (shouldUseHostWorkspace(opts, taskText)) {
      workingDir = opts.workingDir || process.cwd();
      record.hostWorkspace = true;
      record.isolated = false;
    } else {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const os = await import("node:os");
      isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-sub-"));
      workingDir = isolatedDir;
    }
  }

  const childCfg = {
    ...opts.cfg,
    agent: {
      ...(opts.cfg?.agent || {}),
      maxTurns: opts.maxTurns ?? Math.min(opts.cfg?.agent?.maxTurns ?? 8, 8),
      // B4 dynamic roles: caller-narrowed allowlist (already intersected with
      // the parent's — callers can only narrow, never widen)
      ...(Array.isArray(opts.allowTools) && opts.allowTools.length
        ? { allowTools: opts.allowTools }
        : {}),
    },
    // Children run in-process via runAgentLoop, so cfg is the reliable depth
    // carrier: any spawn/swarm tool the child invokes receives this cfg.
    swarm: {
      ...(opts.cfg?.swarm || {}),
      _spawnDepth: spawnDepth + 1,
    },
    security: {
      ...(opts.cfg?.security || {}),
      // subagents inherit but can force auto for lab isolation
      autoApprove: opts.autoApprove ?? opts.cfg?.security?.autoApprove,
      // Pin systemRunPlan cwd to the child workspace (avoids spawn enforce cwd drift)
      planRoot: workingDir || opts.cfg?.security?.planRoot,
    },
    sandbox: {
      ...(opts.cfg?.sandbox || {}),
      enabled: opts.cfg?.sandbox?.enabled !== false,
      // Isolated / worktree children often need /tmp siblings for proof files
      allowPaths: Array.from(
        new Set([
          ...((opts.cfg?.sandbox?.allowPaths || []).map(String)),
          ...(workingDir ? [workingDir] : []),
          // Allow host tmp when child lives under tmp (lab swarm proofs, etc.)
          ...(workingDir && String(workingDir).startsWith("/tmp")
            ? ["/tmp"]
            : []),
        ])
      ),
    },
  };

  const pushEvent = (e) => {
    const ev = { ...e, subagentId: id, parentId, at: Date.now() };
    record.events.push(ev);
    if (record.events.length > 200) record.events.shift();
    opts.onEvent?.(ev);
  };

  pushEvent({ type: "subagent", phase: "start", task: opts.task });

  try {
    const { createNestedSignal } = await import("../utils/abort-handlers.mjs");
    const nest = createNestedSignal(opts.signal, {
      timeoutMs,
      reason: "parent_aborted",
    });
    const ac = nest.controller;

    let result;
    try {
      result = await runAgentLoop({
        // Children are budget-capped by the PARENT — never auto-continue.
        continuation: false,
        userMessage: opts.task,
        cfg: childCfg,
        workingDir: workingDir || process.cwd(),
        signal: nest.signal,
        onEvent: pushEvent,
        ...(opts.provider ? { provider: opts.provider } : {}),
        // A1 ledger correlation: swarm/mission joins resolve node-level work
        ledgerIds: {
          nodeId: id,
          swarmId: opts.swarmId || null,
          ...(opts.ledgerIds || {}),
        },
        // Callers with run-scoped security (missions) pass their own gate —
        // the loop's default shared gate is primed with the GATEWAY's policy
        // and would silently override the child cfg's autoApprove.
        approvalGate: opts.approvalGate,
        // B4: injected local tools (swarm blackboard etc.)
        extraTools: opts.extraTools,
      });
    } finally {
      nest.dispose();
    }

    const childOk = result.ok !== false;
    record.status = childOk ? "done" : "failed";
    record.finishedAt = new Date().toISOString();
    record.workspace = workingDir;
    record.isolated = Boolean(isolatedDir);
    let merge = null;
    if (worktree?.path) {
      try {
        merge = await worktreeDiff(worktree.path);
      } catch (e) {
        merge = { error: e.message };
      }
    }
    record.result = {
      text: result.text,
      turns: result.turns,
      model: result.model,
      sessionId: result.sessionId,
      stopReason: result.stopReason || null,
      ok: childOk,
      toolTrace: result.toolTrace || [],
      workspace: workingDir,
      isolated: Boolean(isolatedDir) || Boolean(worktree),
      worktree: worktree || null,
      merge,
      fabricRole: record.fabricRole || null,
    };
    // C2: also bind computer/agent session id when loop exposes it
    if (result.sessionId && (opts.role || opts.fabricRole || opts.swarmRole || record.fabricRole)) {
      try {
        const { bindSwarmSpawnRole } = await import("../browser/role-binding.mjs");
        await bindSwarmSpawnRole({
          spawnId: id,
          sessionId: result.sessionId,
          agentId: result.sessionId,
          swarmRole: opts.role || opts.swarmRole,
          fabricRole: opts.fabricRole || record.fabricRole,
          source: "swarm",
        });
      } catch {
        /* non-fatal */
      }
    }

    if (childOk) subagentMetrics.completed += 1;
    else subagentMetrics.errors += 1;
    void persist(record);
    pushEvent({
      type: "subagent",
      phase: childOk ? "done" : "failed",
      text: result.text,
      stopReason: result.stopReason || null,
      workspace: workingDir,
      toolCalls: (result.toolTrace || []).length,
      merge: merge
        ? { dirty: merge.dirty, stat: merge.stat?.slice?.(0, 500) }
        : null,
    });
    if (opts.cleanupWorktree && worktree?.path) {
      await removeWorktree(baseDir, worktree.path).catch(() => {});
    }
    return { ok: childOk, ...publicView(record), result: record.result };
  } catch (err) {
    const msg = err.message || String(err);
    const isTimeout = /timeout/i.test(msg) || err.name === "AbortError";
    record.status = isTimeout ? "timeout" : "error";
    record.finishedAt = new Date().toISOString();
    record.error = msg;
    if (isTimeout) subagentMetrics.timeouts += 1;
    else subagentMetrics.errors += 1;
    void persist(record);
    pushEvent({ type: "subagent", phase: isTimeout ? "timeout" : "error", error: record.error });
    return { ok: false, ...publicView(record) };
  }
}

export function createSpawnTool(ctx = {}) {
  return {
    name: "xclaw_spawn_subagent",
    description:
      "Spawn a child agent for a subtask. Returns child id and final text.",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string" },
        maxTurns: { type: "number" },
        isolate: {
          type: "boolean",
          description: "Run in isolated temp workspace (default false)",
        },
        worktree: {
          type: "boolean",
          description: "Use git worktree when repo available",
        },
        role: {
          type: "string",
          description:
            "C2 swarm/fabric role: research|implement|verify|critic|actor|observer|planner — bound as trusted fabric role at spawn",
          enum: [
            "research",
            "implement",
            "verify",
            "critic",
            "actor",
            "observer",
            "planner",
          ],
        },
      },
      required: ["task"],
    },
    async execute({ task, maxTurns, isolate, worktree, role }) {
      const out = await spawnSubagent({
        task,
        maxTurns,
        isolateWorkspace: Boolean(isolate) && !worktree,
        worktree: Boolean(worktree),
        cfg: ctx.cfg,
        parentId: ctx.sessionId || "parent",
        workingDir: ctx.workingDir,
        signal: ctx.signal,
        onEvent: ctx.onEvent,
        role: role || undefined,
        swarmRole: role || undefined,
      });
      if (!out.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: out.error || "subagent failed" }],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                subagentId: out.id,
                status: out.status,
                text: out.result?.text,
                turns: out.result?.turns,
                fabricRole: out.result?.fabricRole || out.fabricRole || null,
              },
              null,
              2
            ),
          },
        ],
      };
    },
  };
}
