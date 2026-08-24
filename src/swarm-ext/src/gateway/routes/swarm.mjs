/**
 * Swarm REST API Routes
 * Mounts at /api/swarm/* in XClaw gateway
 */
import { Router } from "express";
import { Orchestrator } from "../../swarm/orchestrator.mjs";
import { getConfig } from "../../swarm/config.mjs";
import { getSwarmHealth } from "../../swarm/health.mjs";
import { getSessionManager } from "../../swarm/session-manager.mjs";
import { ReceiptGenerator } from "../../swarm/receipt/generator.mjs";

const router = Router();
const orchestrators = new Map();
const receipts = new Map();

function getOrchestrator(sessionId, llmClient, toolRegistry) {
  if (!orchestrators.has(sessionId)) {
    orchestrators.set(sessionId, new Orchestrator(llmClient, toolRegistry));
  }
  return orchestrators.get(sessionId);
}

// POST /api/swarm/goals — Submit a new goal
router.post("/goals", async (req, res) => {
  try {
    const { goal, sessionId = "default", profile = "lab", context = {}, constraints = {}, outputFormat } = req.body;

    if (!goal) {
      return res.status(400).json({ error: "Missing 'goal' field" });
    }

    console.log(`[swarm-api] Goal from ${sessionId}: ${goal.slice(0, 100)}...`);

    const llmClient = req.xclaw?.llmClient || req.app.locals.llmClient;
    const toolRegistry = req.xclaw?.toolRegistry || req.app.locals.toolRegistry;

    if (!llmClient) {
      return res.status(500).json({ error: "LLM client not available" });
    }

    const cfg = getConfig().swarm;
    const maxSubAgents = constraints.maxSubAgents || cfg.orchestrator.maxSubAgents;

    const request = {
      query: goal,
      maxSubAgents: profile === "prod" ? Math.min(maxSubAgents, 10) : maxSubAgents,
      timeoutSeconds: constraints.timeoutSeconds || cfg.orchestrator.timeoutSeconds,
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

    const orchestrator = getOrchestrator(sessionId, llmClient, toolRegistry);

    // Pre-generate the task id and thread it through submit() so the id we
    // return is the id the orchestrator actually registers. (Vendor bug: the
    // original generated a SECOND unrelated id here — polling it 404'd forever.)
    const taskId = generateTaskId();
    request.taskId = taskId;

    // Start async execution
    orchestrator.submit(request, sessionId).catch(err => {
      console.error("[swarm-api] Orchestrator error:", err.message);
    });
    res.status(202).json({
      id: taskId,
      status: "pending",
      message: "Goal accepted. Poll GET /api/swarm/tasks/:id for results.",
      pollInterval: 2000,
    });

  } catch (e) {
    console.error("[swarm-api] Error handling goal:", e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/swarm/tasks/:id — Get task status and results
router.get("/tasks/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const sessionId = req.query.sessionId || "default";

    const orchestrator = orchestrators.get(sessionId);
    if (!orchestrator) {
      return res.status(404).json({ error: "No orchestrator for session" });
    }

    const task = orchestrator.getTask(id);
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    const statusMap = {
      pending: "pending",
      analyzing: "running",
      spawning: "running",
      running: "running",
      aggregating: "running",
      completed: "done",
      failed: "error",
      cancelled: "error",
    };

    const final = task.finalResult || {};
    const parallelRatio = task.subTasks?.length
      ? task.subTasks.filter(t => !t.dependencies?.length).length / task.subTasks.length
      : 0;

    res.json({
      id: task.taskId,
      status: statusMap[task.status] || "unknown",
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
        completed: task.subTasks?.filter(t => t.status === "completed").length || 0,
        failed: task.subTasks?.filter(t => t.status === "failed").length || 0,
        total: task.subTasks?.length || 0,
      },
      durationMs: Math.round((task.durationSeconds || 0) * 1000),
      tokenUsage: task.tokensUsed,
      error: task.error,
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/swarm/tasks/:id/cancel
router.post("/tasks/:id/cancel", async (req, res) => {
  try {
    const { id } = req.params;
    const sessionId = req.query.sessionId || "default";
    const orchestrator = orchestrators.get(sessionId);
    if (!orchestrator) {
      return res.status(404).json({ error: "No orchestrator found" });
    }
    const cancelled = await orchestrator.cancelTask(id);
    res.json({ taskId: id, cancelled });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/swarm/health
router.get("/health", async (req, res) => {
  const health = await getSwarmHealth();
  res.json(health);
});

// GET /api/swarm/stats
router.get("/stats", async (req, res) => {
  const stats = {};
  for (const [sessionId, orch] of orchestrators) {
    stats[sessionId] = orch.getStats();
  }
  res.json({ sessions: stats });
});

// GET /api/swarm/sessions
router.get("/sessions", async (req, res) => {
  const manager = getSessionManager();
  res.json(manager.listSessions());
});

function generateTaskId() {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export default router;
