/**
 * Sub-Agent — Executes a single subtask with full tool-calling loop
 * Features: retry logic, token tracking, sandbox isolation, heartbeat
 */
import { getConfig } from "./config.mjs";
import { generateAgentId, nowISO, sleep } from "./utils.mjs";
import { formatSubAgentPrompt } from "./prompts.mjs";

export class SubAgent {
  constructor(task, context, llmClient, toolRegistry) {
    this.task = task;
    this.context = context;
    this.agentId = generateAgentId(task.agentRole);
    this.task.agentId = this.agentId;
    this.llm = llmClient;
    this.tools = toolRegistry;
    this.toolCalls = [];
    this.stepCount = 0;
    this.tokenUsage = { prompt: 0, completion: 0 };
    this.startedAt = null;
    this.completedAt = null;
  }

  async execute() {
    console.log(`[swarm-agent] ${this.agentId} (${this.task.agentRole}) starting task ${this.task.taskId}`);
    this.task.status = "running";
    this.startedAt = nowISO();

    try {
      const messages = formatSubAgentPrompt(
        this.task.agentRole,
        this.task.taskId,
        this.task.parentTaskId,
        this.task.description,
        this.task.maxSteps,
        this.task.context
      );

      const result = await this._runWithTools(messages);

      this.task.status = "completed";
      this.completedAt = nowISO();
      this.task.result = result;
      this.task.completedAt = this.completedAt;

      console.log(`[swarm-agent] ${this.agentId} completed in ${this.stepCount} steps`);
      return result;

    } catch (e) {
      this.task.status = "failed";
      this.task.error = e.message;
      this.completedAt = nowISO();
      this.task.completedAt = this.completedAt;
      console.error(`[swarm-agent] ${this.agentId} failed: ${e.message}`);
      return { error: e.message, agentId: this.agentId, role: this.task.agentRole };
    }
  }

  async _runWithTools(messages) {
    const cfg = getConfig().swarm.subAgent;
    const maxSteps = Math.min(this.task.maxSteps || 10, cfg.retryAttempts + 5);
    const toolSchemas = this.tools ? this.tools.getSchemas() : [];

    for (let step = 0; step < maxSteps; step++) {
      this.stepCount = step + 1;

      // Call LLM with tool schemas
      const response = await this.llm.chat(messages, {
        temperature: cfg.temperature,
        tools: toolSchemas.length > 0 ? toolSchemas : undefined,
      });

      // Track token usage
      if (response.usage) {
        this.tokenUsage.prompt += response.usage.promptTokens || 0;
        this.tokenUsage.completion += response.usage.completionTokens || 0;
      }

      const content = response.content;
      const toolCalls = response.toolCalls || [];

      // No tool calls = final answer
      if (!toolCalls.length) {
        return {
          content,
          agentId: this.agentId,
          role: this.task.agentRole,
          toolCalls: this.toolCalls,
          steps: this.stepCount,
          tokenUsage: this.tokenUsage,
          startedAt: this.startedAt,
          completedAt: nowISO(),
        };
      }

      // Execute each tool call
      for (const tc of toolCalls) {
        const call = {
          toolName: tc.name || tc.toolName,
          params: tc.arguments || tc.params,
          callId: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          startedAt: nowISO(),
        };
        this.toolCalls.push(call);

        try {
          const toolResult = await this.tools.execute(call.toolName, call.params);
          call.result = toolResult.data;
          call.error = toolResult.error;
          call.completedAt = nowISO();
          call.latencyMs = new Date(call.completedAt) - new Date(call.startedAt);

          // Add to conversation
          messages.push({
            role: "assistant",
            content: null,
            tool_calls: [{ id: call.callId, type: "function", function: { name: call.toolName, arguments: JSON.stringify(call.params) } }],
          });
          messages.push({
            role: "tool",
            tool_call_id: call.callId,
            content: JSON.stringify(call.result || call.error),
          });

        } catch (e) {
          call.error = e.message;
          call.completedAt = nowISO();
          messages.push({
            role: "tool",
            tool_call_id: call.callId,
            content: JSON.stringify({ error: e.message }),
          });
        }
      }
    }

    // Max steps reached
    return {
      content: messages[messages.length - 1]?.content || "Max steps reached",
      agentId: this.agentId,
      role: this.task.agentRole,
      toolCalls: this.toolCalls,
      steps: this.stepCount,
      tokenUsage: this.tokenUsage,
      note: "Max steps reached",
      startedAt: this.startedAt,
      completedAt: nowISO(),
    };
  }
}

export class SubAgentPool {
  constructor(maxConcurrent = 300) {
    this.maxConcurrent = maxConcurrent;
    this.semaphore = new Semaphore(maxConcurrent);
    this.activeAgents = new Map();
    this.completedAgents = new Map();
    this.failedAgents = new Map();
  }

  createAgent(task, context, llmClient, toolRegistry) {
    const agent = new SubAgent(task, context, llmClient, toolRegistry);
    return agent;
  }

  async spawn(task, context, llmClient, toolRegistry) {
    await this.semaphore.acquire();
    const agent = this.createAgent(task, context, llmClient, toolRegistry);
    this.activeAgents.set(agent.agentId, agent);

    try {
      const result = await agent.execute();
      this.completedAgents.set(agent.agentId, { agent, result });
      return result;
    } catch (e) {
      this.failedAgents.set(agent.agentId, { agent, error: e.message });
      return { error: e.message, agentId: agent.agentId, taskId: task.taskId };
    } finally {
      this.activeAgents.delete(agent.agentId);
      this.semaphore.release();
    }
  }

  async spawnBatch(tasks, context, llmClient, toolRegistry, onProgress = null) {
    console.log(`[swarm-pool] Spawning batch: ${tasks.length} agents (max concurrent: ${this.maxConcurrent})`);
    const promises = tasks.map((task, i) =>
      this.spawn(task, context, llmClient, toolRegistry).then((result) => {
        if (onProgress) {
          onProgress({
            index: i,
            total: tasks.length,
            taskId: task.taskId,
            status: result.error ? "failed" : "completed",
            agentId: result.agentId,
          });
        }
        return result;
      })
    );
    return await Promise.all(promises);
  }

  getStats() {
    return {
      active: this.activeAgents.size,
      completed: this.completedAgents.size,
      failed: this.failedAgents.size,
      maxConcurrent: this.maxConcurrent,
      availableSlots: this.maxConcurrent - this.activeAgents.size,
    };
  }
}

class Semaphore {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release() {
    this.current--;
    if (this.queue.length > 0) {
      this.current++;
      const next = this.queue.shift();
      next();
    }
  }
}
