/**
 * Swarm decompose-engine runtime (ADR 0004 — swarm unification).
 *
 * Successor to the isolated swarm-ext express mount: builds the LLM adapter,
 * tool registries and per-session orchestrators ONCE and exposes plain async
 * functions for the gateway route (src/gateway/routes/swarm-goals.mjs).
 * No express, no redis — the whole engine now runs in-process on zero
 * external dependencies.
 *
 * The vendored /batch endpoint was NOT carried over: it fabricated task ids
 * without executing anything. /receipts/:id duplicated the receipt already
 * returned by the task view.
 */
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const swarmRoot = dirname(fileURLToPath(import.meta.url));

/** Operator config for the decompose engine — cfg.swarm.decompose with
 *  back-compat for the pre-unification cfg.swarmExt block. */
export function decomposeCfg(cfg = {}) {
  return cfg.swarm?.decompose ?? cfg.swarmExt ?? {};
}

let runtimePromise = null;

export async function getSwarmRuntime(cfg) {
  if (!runtimePromise) {
    runtimePromise = buildRuntime(cfg).catch((err) => {
      runtimePromise = null; // allow retry after transient failure
      throw err;
    });
  }
  return runtimePromise;
}

export function resetSwarmRuntime() {
  runtimePromise = null;
}

async function buildRuntime(xclawCfg) {
  const dc = decomposeCfg(xclawCfg);
  const { loadConfig, setConfig } = await import("./decompose/config.mjs");

  // Engine config from INSIDE the subtree (never cwd), then pin
  // deployment-specific values.
  const swarmCfg = loadConfig(join(swarmRoot, "decompose-config.json"));
  swarmCfg.swarm.plugins.directory = join(swarmRoot, "plugins");
  // vendor metrics.mjs starts an http server on prometheusPort — never auto-bind
  swarmCfg.swarm.telemetry = { ...(swarmCfg.swarm.telemetry || {}), enabled: false };
  const parlDir = join(swarmRoot, "..", "..", ".xclaw", "swarm");
  try {
    mkdirSync(parlDir, { recursive: true });
  } catch {
    /* best-effort */
  }
  if (swarmCfg.swarm.parl) swarmCfg.swarm.parl.exportPath = join(parlDir, "parl-samples.jsonl");
  // Route both roles through xclaw's actual configured model.
  const model = dc.model || xclawCfg?.agent?.model;
  if (model) {
    swarmCfg.swarm.orchestrator.model = model;
    swarmCfg.swarm.subAgent.model = model;
  }
  if (Number.isFinite(dc.maxSubAgents)) {
    swarmCfg.swarm.orchestrator.maxSubAgents = dc.maxSubAgents;
  }
  if (Number.isFinite(dc.maxConcurrent)) {
    swarmCfg.swarm.subAgent.maxConcurrent = dc.maxConcurrent;
  }
  setConfig(swarmCfg);

  const { createSwarmLlmAdapter } = await import("./llm-adapter.mjs");
  const llmClient = await createSwarmLlmAdapter(xclawCfg, { model: dc.model });

  const { PluginRegistry } = await import("./decompose/plugin-registry.mjs");
  const pluginRegistry = new PluginRegistry();
  await pluginRegistry.loadPlugins();

  // Bridge to xclaw's REAL tool router — real tools win name collisions,
  // plugins fill the gaps; degrade LOUDLY to plugins-only if the computer
  // plane is down.
  let toolRegistry = pluginRegistry;
  if (dc.tools?.enabled !== false) {
    try {
      const { createXclawToolBridge, createMergedToolRegistry } = await import("./tool-bridge.mjs");
      const bridge = await createXclawToolBridge(xclawCfg);
      toolRegistry = createMergedToolRegistry(bridge, pluginRegistry);
      console.log(
        `[swarm] tool bridge up: ${bridge.list().length} real tools (ws=${bridge.workingDir}), plugins fill gaps`
      );
    } catch (err) {
      console.error(`[swarm] tool bridge UNAVAILABLE — plugin tools only: ${err.message}`);
    }
  }

  const { Orchestrator } = await import("./decompose/orchestrator.mjs");
  const orchestrators = new Map();
  const getOrchestrator = (sessionId) => {
    if (!orchestrators.has(sessionId)) {
      orchestrators.set(sessionId, new Orchestrator(llmClient, toolRegistry));
    }
    return orchestrators.get(sessionId);
  };

  console.log(
    `[swarm] decompose engine ready (model=${llmClient.model}, tools=${toolRegistry?.getSchemas?.().length ?? 0}, maxSubAgents=${swarmCfg.swarm.orchestrator.maxSubAgents})`
  );

  return { swarmCfg, llmClient, toolRegistry, orchestrators, getOrchestrator };
}

function generateTaskId() {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const STATUS_MAP = {
  pending: "pending",
  analyzing: "running",
  spawning: "running",
  running: "running",
  aggregating: "running",
  completed: "done",
  failed: "error",
  cancelled: "error",
};

/** POST /swarm/goals */
export async function submitGoal(cfg, body = {}) {
  const { goal, sessionId = "default", profile = "lab", context = {}, constraints = {}, outputFormat } = body;
  if (!goal) return { status: 400, body: { error: "Missing 'goal' field" } };
  const rt = await getSwarmRuntime(cfg);
  console.log(`[swarm] goal from ${sessionId}: ${String(goal).slice(0, 100)}...`);
  const sc = rt.swarmCfg.swarm;
  const maxSubAgents = constraints.maxSubAgents || sc.orchestrator.maxSubAgents;
  const taskId = generateTaskId();
  const request = {
    query: goal,
    taskId,
    maxSubAgents: profile === "prod" ? Math.min(maxSubAgents, 10) : maxSubAgents,
    timeoutSeconds: constraints.timeoutSeconds || sc.orchestrator.timeoutSeconds,
    outputFormat: outputFormat || "markdown",
    contextFiles: context.files,
    priority: 5,
    metadata: {
      xclawSessionId: sessionId,
      xclawProfile: profile,
      xclawComputerState: context.computerState,
      xclawHistory: context.history,
    },
  };
  rt.getOrchestrator(sessionId)
    .submit(request, sessionId)
    .catch((err) => console.error("[swarm] orchestrator error:", err.message));
  return {
    status: 202,
    body: {
      id: taskId,
      status: "pending",
      message: "Goal accepted. Poll GET /swarm/tasks/:id for results.",
      pollInterval: 2000,
    },
  };
}

/** GET /swarm/tasks/:id */
export async function getTaskView(cfg, id, sessionId = "default") {
  const rt = await getSwarmRuntime(cfg);
  const orchestrator = rt.orchestrators.get(sessionId);
  if (!orchestrator) return { status: 404, body: { error: "No orchestrator for session" } };
  const task = orchestrator.getTask(id);
  if (!task) return { status: 404, body: { error: "Task not found" } };
  const final = task.finalResult || {};
  const parallelRatio = task.subTasks?.length
    ? task.subTasks.filter((t) => !t.dependencies?.length).length / task.subTasks.length
    : 0;
  return {
    status: 200,
    body: {
      id: task.taskId,
      status: STATUS_MAP[task.status] || "unknown",
      result: {
        summary: final.summary || "",
        content: final.detailedResult || "",
        artifacts: final.artifacts || [],
        confidence: final.confidenceScore || 0,
      },
      receipt: task.receipt || null,
      swarm: {
        subAgents: task.subTasks?.length || 0,
        parallelRatio: Math.round(parallelRatio * 100) / 100,
        planReasoning: task.plan?.reasoning || "",
        executionGroups: task.plan?.executionGroups?.length || 0,
      },
      progress: {
        completed: task.subTasks?.filter((t) => t.status === "completed").length || 0,
        failed: task.subTasks?.filter((t) => t.status === "failed").length || 0,
        total: task.subTasks?.length || 0,
      },
      durationMs: Math.round((task.durationSeconds || 0) * 1000),
      tokenUsage: task.tokensUsed,
      error: task.error,
    },
  };
}

/** POST /swarm/tasks/:id/cancel */
export async function cancelTask(cfg, id, sessionId = "default") {
  const rt = await getSwarmRuntime(cfg);
  const orchestrator = rt.orchestrators.get(sessionId);
  if (!orchestrator) return { status: 404, body: { error: "No orchestrator found" } };
  const cancelled = await orchestrator.cancelTask(id);
  return { status: 200, body: { taskId: id, cancelled } };
}

/** GET /swarm/decompose/health */
export async function decomposeHealth(cfg) {
  await getSwarmRuntime(cfg);
  const { getSwarmHealth } = await import("./decompose/health.mjs");
  return { status: 200, body: await getSwarmHealth() };
}

/** GET /swarm/decompose/stats */
export async function decomposeStats(cfg) {
  const rt = await getSwarmRuntime(cfg);
  const stats = {};
  for (const [sessionId, orch] of rt.orchestrators) stats[sessionId] = orch.getStats();
  return { status: 200, body: { sessions: stats } };
}

/** GET /swarm/decompose/sessions */
export async function decomposeSessions(cfg) {
  await getSwarmRuntime(cfg);
  const { getSessionManager } = await import("./decompose/session-manager.mjs");
  return { status: 200, body: getSessionManager().listSessions() };
}

export default {
  decomposeCfg,
  getSwarmRuntime,
  resetSwarmRuntime,
  submitGoal,
  getTaskView,
  cancelTask,
  decomposeHealth,
  decomposeStats,
  decomposeSessions,
};
