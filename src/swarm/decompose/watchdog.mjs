/**
 * Watchdog — Monitors and kills hung tasks/agents
 * Prevents resource leaks and infinite loops
 */
import { getConfig } from "./config.mjs";
import { nowISO, sleep } from "./utils.mjs";

export class Watchdog {
  constructor() {
    const cfg = getConfig().swarm.watchdog;
    this.enabled = cfg.enabled;
    this.taskTimeoutMs = (cfg.taskTimeoutSeconds || 1800) * 1000;
    this.agentTimeoutMs = (cfg.agentTimeoutSeconds || 600) * 1000;
    this.cleanupIntervalMs = (cfg.cleanupIntervalSeconds || 60) * 1000;
    this.tasks = new Map();
    this.agents = new Map();
    this.running = false;
  }

  start() {
    if (!this.enabled || this.running) return;
    this.running = true;
    console.log("[swarm-watchdog] Started");
    this._loop();
  }

  stop() {
    this.running = false;
    console.log("[swarm-watchdog] Stopped");
  }

  async _loop() {
    while (this.running) {
      await this._checkTasks();
      await this._checkAgents();
      await sleep(this.cleanupIntervalMs);
    }
  }

  registerTask(taskId, onTimeout) {
    this.tasks.set(taskId, {
      taskId,
      startedAt: Date.now(),
      onTimeout,
      warned: false,
    });
  }

  registerAgent(agentId, onTimeout) {
    this.agents.set(agentId, {
      agentId,
      startedAt: Date.now(),
      onTimeout,
      warned: false,
    });
  }

  unregisterTask(taskId) {
    this.tasks.delete(taskId);
  }

  unregisterAgent(agentId) {
    this.agents.delete(agentId);
  }

  async _checkTasks() {
    const now = Date.now();
    for (const [taskId, task] of this.tasks) {
      const elapsed = now - task.startedAt;

      if (elapsed > this.taskTimeoutMs) {
        console.error(`[swarm-watchdog] Task ${taskId} timed out after ${elapsed}ms`);
        try {
          await task.onTimeout(taskId, elapsed);
        } catch (e) {
          console.error(`[swarm-watchdog] Task timeout handler failed:`, e.message);
        }
        this.tasks.delete(taskId);
      } else if (elapsed > this.taskTimeoutMs * 0.8 && !task.warned) {
        console.warn(`[swarm-watchdog] Task ${taskId} approaching timeout (${Math.round(elapsed / 1000)}s / ${this.taskTimeoutMs / 1000}s)`);
        task.warned = true;
      }
    }
  }

  async _checkAgents() {
    const now = Date.now();
    for (const [agentId, agent] of this.agents) {
      const elapsed = now - agent.startedAt;

      if (elapsed > this.agentTimeoutMs) {
        console.error(`[swarm-watchdog] Agent ${agentId} timed out after ${elapsed}ms`);
        try {
          await agent.onTimeout(agentId, elapsed);
        } catch (e) {
          console.error(`[swarm-watchdog] Agent timeout handler failed:`, e.message);
        }
        this.agents.delete(agentId);
      } else if (elapsed > this.agentTimeoutMs * 0.8 && !agent.warned) {
        console.warn(`[swarm-watchdog] Agent ${agentId} approaching timeout`);
        agent.warned = true;
      }
    }
  }

  getStats() {
    return {
      tasksMonitored: this.tasks.size,
      agentsMonitored: this.agents.size,
      taskTimeoutMs: this.taskTimeoutMs,
      agentTimeoutMs: this.agentTimeoutMs,
      cleanupIntervalMs: this.cleanupIntervalMs,
    };
  }
}

let _watchdog = null;

export function getWatchdog() {
  if (!_watchdog) {
    _watchdog = new Watchdog();
  }
  return _watchdog;
}
