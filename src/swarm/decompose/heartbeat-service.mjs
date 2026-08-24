/**
 * Heartbeat Service — Monitors agent health with exponential backoff
 * Auto-disables agents after consecutive failures
 * Based on SwarmClaw's classifyWakeOutcome pattern
 */
import { getConfig } from "./config.mjs";
import { sleep } from "./utils.mjs";

export class HeartbeatService {
  constructor() {
    const cfg = getConfig().swarm.heartbeat;
    this.enabled = cfg.enabled;
    this.intervalMs = (cfg.intervalSeconds || 30) * 1000;
    this.maxConsecutiveFailures = cfg.maxConsecutiveFailures || 10;
    this.backoffStrategy = cfg.backoffStrategy || "exponential";
    this.agents = new Map(); // agentId -> health record
    this.intervals = new Map();
  }

  registerAgent(agentId, checkFn, onFailure = null) {
    if (!this.enabled) return;

    this.agents.set(agentId, {
      id: agentId,
      status: "healthy",
      consecutiveFailures: 0,
      lastCheck: null,
      lastSuccess: null,
      nextCheck: Date.now(),
      checkFn,
      onFailure,
      disabled: false,
    });

    this._startHeartbeat(agentId);
  }

  _startHeartbeat(agentId) {
    const runCheck = async () => {
      const agent = this.agents.get(agentId);
      if (!agent || agent.disabled) return;

      try {
        const result = await agent.checkFn();
        const outcome = this._classifyOutcome(result);

        if (outcome === null) {
          // Success
          agent.consecutiveFailures = 0;
          agent.lastSuccess = Date.now();
          agent.status = "healthy";
        } else {
          // Failure
          agent.consecutiveFailures++;
          agent.status = "degraded";
          console.warn(`[swarm-heartbeat] Agent ${agentId} failure ${agent.consecutiveFailures}/${this.maxConsecutiveFailures}: ${outcome}`);

          if (agent.consecutiveFailures >= this.maxConsecutiveFailures) {
            agent.disabled = true;
            agent.status = "disabled";
            console.error(`[swarm-heartbeat] Agent ${agentId} auto-disabled after ${this.maxConsecutiveFailures} failures`);
            if (agent.onFailure) {
              agent.onFailure(agentId, outcome);
            }
          }
        }

        agent.lastCheck = Date.now();
      } catch (e) {
        agent.consecutiveFailures++;
        console.error(`[swarm-heartbeat] Agent ${agentId} check error:`, e.message);
      }

      // Schedule next check with backoff
      const delay = this._calculateBackoff(agent.consecutiveFailures);
      agent.nextCheck = Date.now() + delay;
      this.intervals.set(agentId, setTimeout(runCheck, delay));
    };

    runCheck();
  }

  _classifyOutcome(result) {
    // Returns null for success, string reason for failure
    // Based on SwarmClaw's classifyWakeOutcome
    if (result === null || result === undefined) return "null_result";
    if (typeof result === "object") {
      if (result.error && (typeof result.error === "string" && result.error.trim() !== "")) {
        return result.error;
      }
      if (result.text === "" || (typeof result.text === "string" && result.text.trim() === "")) {
        return "empty_output";
      }
      if (result.statusCode >= 400) {
        return `http_${result.statusCode}`;
      }
    }
    return null; // Success
  }

  _calculateBackoff(failureCount) {
    if (this.backoffStrategy === "exponential") {
      // 10s -> 20s -> 40s -> 80s -> ... up to 5min
      return Math.min(this.intervalMs * Math.pow(2, failureCount), 300000);
    }
    if (this.backoffStrategy === "linear") {
      return this.intervalMs * (failureCount + 1);
    }
    return this.intervalMs;
  }

  unregisterAgent(agentId) {
    const timeout = this.intervals.get(agentId);
    if (timeout) {
      clearTimeout(timeout);
      this.intervals.delete(agentId);
    }
    this.agents.delete(agentId);
  }

  getAgentHealth(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    return {
      id: agent.id,
      status: agent.status,
      consecutiveFailures: agent.consecutiveFailures,
      lastCheck: agent.lastCheck,
      lastSuccess: agent.lastSuccess,
      nextCheck: agent.nextCheck,
      disabled: agent.disabled,
    };
  }

  getAllHealth() {
    const health = {};
    for (const [id, agent] of this.agents) {
      health[id] = this.getAgentHealth(id);
    }
    return health;
  }

  resetAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.consecutiveFailures = 0;
    agent.status = "healthy";
    agent.disabled = false;
    return true;
  }

  shutdown() {
    for (const [agentId, timeout] of this.intervals) {
      clearTimeout(timeout);
    }
    this.intervals.clear();
    this.agents.clear();
  }
}
