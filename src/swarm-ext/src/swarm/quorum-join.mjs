/**
 * Quorum Join — Distributed consensus for multi-orchestrator setups
 * Ensures only one orchestrator leads a session via Redis-backed consensus
 */
import Redis from "ioredis";
import { getConfig } from "./config.mjs";

export class QuorumJoin {
  constructor(redisUrl = null) {
    const cfg = getConfig().swarm.taskQueue;
    this.redis = new Redis(redisUrl || cfg.brokerUrl);
    this.nodeId = `node_${process.pid}_${Date.now().toString(36)}`;
    this.leaseTTL = 10; // seconds
    this.leader = false;
    this.heartbeatInterval = null;
  }

  async join(sessionId) {
    const lockKey = `swarm:quorum:${sessionId}`;
    const acquired = await this.redis.set(lockKey, this.nodeId, "EX", this.leaseTTL, "NX");
    if (acquired === "OK") {
      this.leader = true;
      this._startHeartbeat(lockKey);
      console.log(`[swarm-quorum] ${this.nodeId} is LEADER for session ${sessionId}`);
      return { leader: true, nodeId: this.nodeId };
    }

    const currentLeader = await this.redis.get(lockKey);
    console.log(`[swarm-quorum] ${this.nodeId} is FOLLOWER for session ${sessionId} (leader: ${currentLeader})`);
    return { leader: false, nodeId: this.nodeId, leaderId: currentLeader };
  }

  async leave(sessionId) {
    const lockKey = `swarm:quorum:${sessionId}`;
    if (this.leader) {
      this._stopHeartbeat();
      await this.redis.del(lockKey);
      this.leader = false;
      console.log(`[swarm-quorum] ${this.nodeId} released leadership for ${sessionId}`);
    }
  }

  _startHeartbeat(lockKey) {
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.redis.expire(lockKey, this.leaseTTL);
      } catch (e) {
        console.error("[swarm-quorum] Heartbeat failed:", e.message);
        this.leader = false;
        this._stopHeartbeat();
      }
    }, (this.leaseTTL * 1000) / 2);
  }

  _stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  async getLeader(sessionId) {
    const lockKey = `swarm:quorum:${sessionId}`;
    return await this.redis.get(lockKey);
  }

  isLeader() {
    return this.leader;
  }
}
