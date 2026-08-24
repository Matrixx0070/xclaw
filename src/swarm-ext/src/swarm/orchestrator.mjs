/**
 * Orchestrator — The brain of the XClaw Agent Swarm
 * 
 * Full pipeline:
 * 1. Parse goal → validate
 * 2. LLM decomposition → structured plan with subtasks
 * 3. DAG validation → cycle detection, topological sort
 * 4. Execution groups → parallel batches with dependency chains
 * 5. Sub-agent spawning → up to 300 concurrent via pool
 * 6. Progress tracking → Redis pub/sub + WebSocket
 * 7. Result aggregation → merge policy (LLM/vote/quorum/concat)
 * 8. Receipt generation → XClaw-compatible receipt
 * 9. PARL feedback → reward model training sample
 */
import { getConfig } from "./config.mjs";
import { generateTaskId, nowISO, sleep } from "./utils.mjs";
import { formatOrchestratorPrompt } from "./prompts.mjs";
import { getTaskQueue } from "./task-queue.mjs";
import { SubAgentPool } from "./sub-agent.mjs";
import { ResultAggregator } from "./result-aggregator.mjs";
import { ContextSharder } from "./context-sharder.mjs";
import { DAGEngine } from "./dag-engine.mjs";
import { ExecutionGroup, ExecutionGroupManager } from "./execution-group.mjs";
import { getSessionManager } from "./session-manager.mjs";
import { getMemoryStore } from "./memory-store.mjs";
import { BudgetTracker } from "./budget-tracker.mjs";
import { getWatchdog } from "./watchdog.mjs";
import { HeartbeatService } from "./heartbeat-service.mjs";
import { PARLTrainer } from "./parl-trainer.mjs";

export class Orchestrator {
  constructor(llmClient, toolRegistry) {
    const cfg = getConfig().swarm;
    this.llm = llmClient;
    this.tools = toolRegistry;
    this.pool = new SubAgentPool(cfg.subAgent.maxConcurrent);
    this.aggregator = new ResultAggregator(llmClient);
    this.sharder = new ContextSharder();
    this.dag = new DAGEngine(llmClient);
    this.groupManager = new ExecutionGroupManager();
    this.sessionManager = getSessionManager();
    this.heartbeat = new HeartbeatService();
    this.watchdog = getWatchdog();
    this.parl = new PARLTrainer(llmClient);
    this.activeTasks = new Map();
    this.taskBudgets = new Map();
  }

  async submit(request, sessionId = "default") {
    // Honor a caller-provided id (routes pre-generate it so the HTTP 202
    // response and the registered task share one id).
    const taskId = request.taskId || generateTaskId();
    const startTime = Date.now();
    console.log(`[swarm-orchestrator] === TASK ${taskId} STARTED ===`);
    console.log(`[swarm-orchestrator] Query: ${request.query.slice(0, 120)}...`);

    // Initialize task state
    const response = {
      taskId,
      status: "analyzing",
      plan: null,
      subTasks: [],
      finalResult: null,
      artifacts: [],
      executionLog: [],
      createdAt: nowISO(),
      startedAt: nowISO(),
      completedAt: null,
      durationSeconds: null,
      tokensUsed: {},
      costEstimate: 0,
      error: null,
    };
    this.activeTasks.set(taskId, response);

    // Register with session
    this.sessionManager.registerTask(sessionId, taskId);

    // Initialize budget tracker
    const budget = new BudgetTracker(sessionId, {
      maxTokens: request.maxSubAgents ? request.maxSubAgents * 10000 : undefined,
    });
    this.taskBudgets.set(taskId, budget);

    // Start watchdog
    this.watchdog.registerTask(taskId, async (id, elapsed) => {
      console.error(`[swarm-orchestrator] Task ${id} killed by watchdog after ${elapsed}ms`);
      await this.cancelTask(id);
    });

    try {
      // === STEP 1: CONTEXT SHARDING ===
      let contextShards = [];
      if (request.contextFiles && request.contextFiles.length > 0) {
        await this._broadcast(taskId, "status", { message: "Reading and sharding context files...", step: 1, total: 7 });
        contextShards = await this.sharder.shardFiles(request.contextFiles);
        console.log(`[swarm-orchestrator] Context sharded into ${contextShards.length} shards`);
      }

      // === STEP 2: LLM DECOMPOSITION ===
      await this._broadcast(taskId, "status", { message: "Decomposing task with LLM...", step: 2, total: 7 });
      const plan = await this._createPlan(taskId, request, contextShards);
      response.plan = plan;
      response.status = "spawning";

      // Budget check for planning
      const planTokens = JSON.stringify(plan).length / 3;
      budget.recordUsage(planTokens, budget.estimateCost(planTokens, this.llm.model));

      // === STEP 3: DAG VALIDATION ===
      await this._broadcast(taskId, "status", { message: "Validating dependency graph...", step: 3, total: 7 });
      // Vendor bug: this destructured {resolved, changes} but detectAndBreakCycles
      // returns {hasCycle, tasks, breakingEdges} — changes.length threw on EVERY run.
      const { tasks: cleanTasks, breakingEdges = [] } = await this.dag.detectAndBreakCycles(plan.decomposedTasks);
      if (breakingEdges.length > 0) {
        console.log(`[swarm-orchestrator] Broke ${breakingEdges.length} cycles:`, breakingEdges.map(c => `${c.from}->${c.to}`));
      }
      plan.decomposedTasks = cleanTasks;

      // === STEP 4: BUILD EXECUTION GROUPS ===
      await this._broadcast(taskId, "status", { message: `Building execution groups (${plan.decomposedTasks.length} subtasks)...`, step: 4, total: 7 });
      const groups = this.dag.buildExecutionGroups(plan.decomposedTasks);
      console.log(`[swarm-orchestrator] Built ${groups.length} execution groups`);

      // === STEP 5: EXECUTE GROUPS ===
      response.status = "running";
      const allResults = [];
      const completedTasks = new Set();

      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        await this._broadcast(taskId, "status", {
          message: `Executing group ${i + 1}/${groups.length} (${group.tasks.length} agents)...`,
          step: 5,
          total: 7,
          group: i + 1,
          groupTotal: groups.length,
          groupSize: group.tasks.length,
        });

        // Get actual task objects for this group
        const groupTasks = plan.decomposedTasks.filter(t => group.tasks.includes(t.taskId));

        // Create execution group
        const execGroup = this.groupManager.createGroup(
          `${taskId}_group_${i}`,
          groupTasks,
          { parallel: group.parallel, maxConcurrency: this.pool.maxConcurrent }
        );

        // Execute with progress callback
        const groupResult = await execGroup.execute(
          async (task) => {
            const agent = this.pool.createAgent(task, { taskId }, this.llm, this.tools);
            this.heartbeat.registerAgent(agent.agentId, async () => {
              // Health check: is agent still making progress?
              return agent.stepCount > 0 || agent.task.status !== "pending";
            }, (id, reason) => {
              console.warn(`[swarm-orchestrator] Agent ${id} disabled: ${reason}`);
            });

            this.watchdog.registerAgent(agent.agentId, async (id, elapsed) => {
              console.error(`[swarm-orchestrator] Agent ${id} killed by watchdog`);
              agent.task.status = "failed";
              agent.task.error = `Timeout after ${elapsed}ms`;
            });

            const result = await agent.execute();

            this.heartbeat.unregisterAgent(agent.agentId);
            this.watchdog.unregisterAgent(agent.agentId);

            // Budget tracking
            const agentTokens = result.tokenUsage ? 
              (result.tokenUsage.prompt || 0) + (result.tokenUsage.completion || 0) : 0;
            budget.recordUsage(agentTokens, budget.estimateCost(agentTokens, this.llm.model), {
              agentId: agent.agentId,
              taskId: task.taskId,
            });

            return result;
          },
          (progress) => {
            this._broadcast(taskId, "agent_progress", {
              agentId: progress.taskId,
              status: progress.status,
              group: i + 1,
            });
          }
        );

        // Collect results
        for (const [taskId, result] of Object.entries(groupResult.results)) {
          allResults.push(result);
          completedTasks.add(taskId);
          const task = plan.decomposedTasks.find(t => t.taskId === taskId);
          if (task) {
            task.result = result;
            task.status = "completed";
            task.completedAt = nowISO();
          }
        }

        // Handle failures
        for (const [taskId, error] of Object.entries(groupResult.errors)) {
          const task = plan.decomposedTasks.find(t => t.taskId === taskId);
          if (task) {
            task.status = "failed";
            task.error = error;
            task.completedAt = nowISO();
          }
        }

        // Store intermediate results in memory
        const memory = await getMemoryStore();
        await memory.setSessionMemory(sessionId, `group_${i}_results`, groupResult, 3600);
      }

      response.subTasks = plan.decomposedTasks;

      // === STEP 6: RESULT AGGREGATION ===
      await this._broadcast(taskId, "status", { message: "Aggregating results from all sub-agents...", step: 6, total: 7 });
      const mergePolicy = request.mergePolicy || getConfig().swarm.mergePolicy;
      const final = await this.aggregator.aggregate(
        allResults,
        request.query,
        request.outputFormat || "markdown",
        mergePolicy
      );

      response.finalResult = final;

      // Budget check for aggregation
      const aggTokens = JSON.stringify(final).length / 3;
      budget.recordUsage(aggTokens, budget.estimateCost(aggTokens, this.llm.model), { phase: "aggregation" });

      // === STEP 7: FINALIZE ===
      response.status = "completed";
      response.completedAt = nowISO();
      response.durationSeconds = (Date.now() - startTime) / 1000;
      response.tokensUsed = budget.getSummary();
      response.costEstimate = budget.getSummary().costEstimate;

      // Generate receipt
      const receipt = this._generateReceipt(response, plan, allResults, mergePolicy);
      response.receipt = receipt;

      // Store in memory
      const memory = await getMemoryStore();
      await memory.setSessionMemory(sessionId, `task_${taskId}_result`, response, 86400);
      await memory.appendToHistory(sessionId, {
        role: "orchestrator",
        taskId,
        query: request.query,
        status: "completed",
        duration: response.durationSeconds,
      });

      // PARL feedback
      if (getConfig().swarm.parl.enabled) {
        await this.parl.evaluatePlan(
          request.query,
          plan,
          allResults,
          response.durationSeconds
        );
      }

      await this._broadcast(taskId, "result", final);
      await this._broadcast(taskId, "status", { message: "Task completed successfully", step: 7, total: 7 });

      console.log(`[swarm-orchestrator] === TASK ${taskId} COMPLETED in ${response.durationSeconds.toFixed(1)}s ===`);

    } catch (e) {
      response.status = "failed";
      response.error = e.message;
      response.completedAt = nowISO();
      response.durationSeconds = (Date.now() - startTime) / 1000;

      await this._broadcast(taskId, "error", { message: e.message, stack: e.stack });
      await this._broadcast(taskId, "status", { message: `Task failed: ${e.message}`, step: 7, total: 7 });

      console.error(`[swarm-orchestrator] === TASK ${taskId} FAILED: ${e.message} ===`);
    } finally {
      this.watchdog.unregisterTask(taskId);
      this.taskBudgets.delete(taskId);
      this.sessionManager.updateTaskStatus(sessionId, taskId, response.status, {
        duration: response.durationSeconds,
        error: response.error,
      });
    }

    return response;
  }

  async _createPlan(taskId, request, contextShards = []) {
    const cfg = getConfig().swarm.orchestrator;
    const messages = formatOrchestratorPrompt(request.query, {
      maxSubAgents: request.maxSubAgents || cfg.maxSubAgents,
      outputFormat: request.outputFormat,
      contextFiles: request.contextFiles,
      contextShards: contextShards.length,
    });

    const schema = {
      type: "object",
      properties: {
        reasoning: { type: "string" },
        estimatedSubAgents: { type: "integer" },
        estimatedDurationSeconds: { type: "integer" },
        estimatedTokens: { type: "integer" },
        subtasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              taskId: { type: "string" },
              agentRole: { type: "string" },
              description: { type: "string" },
              toolsNeeded: { type: "array", items: { type: "string" } },
              context: { type: "object" },
              dependencies: { type: "array", items: { type: "string" } },
              priority: { type: "integer" },
              maxSteps: { type: "integer" },
              timeoutSeconds: { type: "integer" },
            },
            required: ["taskId", "agentRole", "description"],
          },
        },
        executionGroups: {
          type: "array",
          items: {
            type: "object",
            properties: {
              groupId: { type: "string" },
              tasks: { type: "array", items: { type: "string" } },
              parallel: { type: "boolean" },
            },
          },
        },
      },
      required: ["reasoning", "subtasks"],
    };

    const response = await this.llm.structuredOutput(messages, schema, cfg.temperature);

    // Add context shard tasks if needed
    const subtasks = (response.subtasks || []).map((st, i) => ({
      taskId: st.taskId || `${taskId}_sub_${i}`,
      parentTaskId: taskId,
      agentRole: st.agentRole || "researcher",
      description: st.description,
      toolsNeeded: st.toolsNeeded || [],
      context: st.context || {},
      dependencies: st.dependencies || [],
      priority: st.priority || 5,
      maxSteps: st.maxSteps || 10,
      timeoutSeconds: st.timeoutSeconds || 300,
      status: "pending",
    }));

    // Add shard analysis tasks
    for (let i = 0; i < contextShards.length; i++) {
      subtasks.push({
        taskId: `${taskId}_shard_${i}`,
        parentTaskId: taskId,
        agentRole: "analyst",
        description: `Analyze context shard ${i + 1}/${contextShards.length}`,
        context: { shard: contextShards[i] },
        toolsNeeded: [],
        dependencies: [],
        priority: 5,
        maxSteps: 10,
        status: "pending",
      });
    }

    return {
      taskId,
      originalQuery: request.query,
      decomposedTasks: subtasks,
      estimatedSubAgents: response.estimatedSubAgents || subtasks.length,
      estimatedDurationSeconds: response.estimatedDurationSeconds || 0,
      estimatedTokens: response.estimatedTokens || 0,
      reasoning: response.reasoning || "",
      executionGroups: response.executionGroups || [],
    };
  }

  _generateReceipt(response, plan, results, mergePolicy) {
    const steps = response.subTasks.map(st => ({
      agentId: st.agentId,
      role: st.agentRole,
      description: st.description,
      status: st.status,
      tools: st.toolsNeeded,
      resultPreview: st.result ? JSON.stringify(st.result).slice(0, 200) : null,
      error: st.error,
      startedAt: st.startedAt,
      completedAt: st.completedAt,
      tokenUsage: st.result?.tokenUsage || {},
    }));

    const toolsUsed = [];
    for (const st of response.subTasks) {
      if (st.result?.toolCalls) {
        for (const tc of st.result.toolCalls) {
          toolsUsed.push(tc.toolName || tc.tool_name || "unknown");
        }
      }
    }

    const parallelRatio = response.subTasks.length
      ? response.subTasks.filter(t => !t.dependencies?.length).length / response.subTasks.length
      : 0;

    return {
      taskId: response.taskId,
      status: response.status === "completed" ? "done" : response.status,
      steps,
      toolsUsed: [...new Set(toolsUsed)],
      durationMs: Math.round((response.durationSeconds || 0) * 1000),
      tokenUsage: response.tokensUsed,
      mergePolicy: mergePolicy.mode,
      confidenceScore: response.finalResult?.confidenceScore || 0,
      parallelRatio: Math.round(parallelRatio * 100) / 100,
      planReasoning: plan.reasoning,
      executionGroups: plan.executionGroups?.length || 0,
      generatedAt: nowISO(),
    };
  }

  async _broadcast(taskId, type, data) {
    try {
      const queue = await getTaskQueue();
      await queue.publishProgress(taskId, { type, ...data });
    } catch (e) {
      console.warn(`[swarm-orchestrator] Broadcast failed:`, e.message);
    }
  }

  getTask(taskId) {
    return this.activeTasks.get(taskId);
  }

  async cancelTask(taskId) {
    const task = this.activeTasks.get(taskId);
    if (!task) return false;

    if (["pending", "analyzing", "spawning", "running"].includes(task.status)) {
      task.status = "cancelled";
      try {
        const queue = await getTaskQueue();
        await queue.clearQueue(taskId);
      } catch (e) {
        console.warn(`[swarm-orchestrator] Cancel queue clear failed:`, e.message);
      }
      console.log(`[swarm-orchestrator] Task ${taskId} cancelled`);
      return true;
    }
    return false;
  }

  getStats() {
    return {
      activeTasks: this.activeTasks.size,
      totalTasks: this.activeTasks.size,
      parlSamples: this.parl.samples?.length || 0,
      sessions: this.sessionManager.listSessions().length,
    };
  }
}
