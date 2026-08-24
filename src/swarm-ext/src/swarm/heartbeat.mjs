/**
 * Heartbeat — Individual agent heartbeat monitor
 * Lightweight per-agent health check
 */
import { getConfig } from "./config.mjs";

export class Heartbeat {
  constructor(agentId, checkFn, onFailure) {
    this.agentId = agentId;
    this.checkFn = checkFn;
    this.onFailure = onFailure;
    this.consecutiveFailures = 0;
    this.maxFailures = getConfig().swarm.heartbeat.maxConsecutiveFailures || 10;
    this.intervalMs = (getConfig().swarm.heartbeat.intervalSeconds || 30) * 1000;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._tick();
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async _tick() {
    if (!this.running) return;

    try {
      const healthy = await this.checkFn(this.agentId);
      if (healthy) {
        this.consecutiveFailures = 0;
      } else {
        this.consecutiveFailures++;
        console.warn(`[swarm-heartbeat] ${this.agentId} failure ${this.consecutiveFailures}/${this.maxFailures}`);
      }
    } catch (e) {
      this.consecutiveFailures++;
      console.warn(`[swarm-heartbeat] ${this.agentId} check error: ${e.message}`);
    }

    if (this.consecutiveFailures >= this.maxFailures) {
      console.error(`[swarm-heartbeat] ${this.agentId} declared dead after ${this.maxFailures} failures`);
      this.onFailure(this.agentId, "max_consecutive_failures");
      this.stop();
      return;
    }

    const backoff = this._getBackoff();
    this.timer = setTimeout(() => this._tick(), backoff);
  }

  _getBackoff() {
    const strategy = getConfig().swarm.heartbeat.backoffStrategy || "exponential";
    const base = this.intervalMs;
    const failures = this.consecutiveFailures;

    switch (strategy) {
      case "exponential":
        return base * Math.pow(2, failures);
      case "linear":
        return base * (1 + failures);
      case "fixed":
      default:
        return base;
    }
  }

  getStatus() {
    return {
      agentId: this.agentId,
      running: this.running,
      consecutiveFailures: this.consecutiveFailures,
      maxFailures: this.maxFailures,
      nextCheckMs: this.timer ? this.intervalMs : 0,
    };
  }
}
