/**
 * Memory Store — Shared memory and context persistence for swarm agents
 * Supports Redis-backed distributed memory with vector embeddings
 */
import Redis from "ioredis";
import { getConfig } from "./config.mjs";
import { nowISO, hashContent } from "./utils.mjs";

export class MemoryStore {
  constructor() {
    const cfg = getConfig().swarm.contextSharding;
    this.redis = new Redis(cfg.vectorStore === "redis" ? getConfig().swarm.taskQueue.brokerUrl : "redis://localhost:6379/2");
    this.embeddingModel = cfg.embeddingModel;
    this.enabled = cfg.enabled;
  }

  async connect() {
    await this.redis.ping();
    console.log("[swarm-memory] Connected");
  }

  // === SHORT-TERM MEMORY (Session-scoped) ===

  async setSessionMemory(sessionId, key, value, ttl = 3600) {
    const memoryKey = `swarm:memory:${sessionId}:${key}`;
    await this.redis.setex(memoryKey, ttl, JSON.stringify(value));
  }

  async getSessionMemory(sessionId, key) {
    const memoryKey = `swarm:memory:${sessionId}:${key}`;
    const value = await this.redis.get(memoryKey);
    return value ? JSON.parse(value) : null;
  }

  async deleteSessionMemory(sessionId, key) {
    const memoryKey = `swarm:memory:${sessionId}:${key}`;
    await this.redis.del(memoryKey);
  }

  async getAllSessionMemory(sessionId) {
    const pattern = `swarm:memory:${sessionId}:*`;
    const keys = await this.redis.keys(pattern);
    const result = {};
    for (const key of keys) {
      const shortKey = key.replace(`swarm:memory:${sessionId}:`, "");
      const value = await this.redis.get(key);
      result[shortKey] = value ? JSON.parse(value) : null;
    }
    return result;
  }

  // === LONG-TERM MEMORY (Cross-session) ===

  async storeFact(fact, metadata = {}) {
    const id = hashContent(fact);
    const entry = {
      id,
      fact,
      metadata,
      createdAt: nowISO(),
      accessCount: 0,
    };
    await this.redis.hset("swarm:facts", id, JSON.stringify(entry));
    return id;
  }

  async getFact(id) {
    const entry = await this.redis.hget("swarm:facts", id);
    if (!entry) return null;
    const parsed = JSON.parse(entry);
    parsed.accessCount++;
    parsed.lastAccessed = nowISO();
    await this.redis.hset("swarm:facts", id, JSON.stringify(parsed));
    return parsed;
  }

  async searchFacts(query, limit = 10) {
    // Simple keyword search — replace with vector search in production
    const allFacts = await this.redis.hgetall("swarm:facts");
    const results = [];
    const queryLower = query.toLowerCase();

    for (const [id, entry] of Object.entries(allFacts)) {
      const parsed = JSON.parse(entry);
      if (parsed.fact.toLowerCase().includes(queryLower)) {
        results.push({ ...parsed, score: 1.0 });
      }
    }

    return results.slice(0, limit);
  }

  // === CONVERSATION HISTORY ===

  async appendToHistory(sessionId, entry) {
    const key = `swarm:history:${sessionId}`;
    const historyEntry = { ...entry, timestamp: nowISO() };
    await this.redis.lpush(key, JSON.stringify(historyEntry));
    await this.redis.ltrim(key, 0, 999); // Keep last 1000 entries
    await this.redis.expire(key, 86400);
  }

  async getHistory(sessionId, limit = 100) {
    const key = `swarm:history:${sessionId}`;
    const entries = await this.redis.lrange(key, 0, limit - 1);
    return entries.map((e) => JSON.parse(e)).reverse();
  }

  async clearHistory(sessionId) {
    const key = `swarm:history:${sessionId}`;
    await this.redis.del(key);
  }

  // === ARTIFACT STORAGE ===

  async storeArtifact(sessionId, artifact) {
    const id = artifact.id || `art_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const key = `swarm:artifact:${sessionId}:${id}`;
    await this.redis.setex(key, 86400, JSON.stringify({ ...artifact, id, createdAt: nowISO() }));
    return id;
  }

  async getArtifact(sessionId, id) {
    const key = `swarm:artifact:${sessionId}:${id}`;
    const value = await this.redis.get(key);
    return value ? JSON.parse(value) : null;
  }

  async getAllArtifacts(sessionId) {
    const pattern = `swarm:artifact:${sessionId}:*`;
    const keys = await this.redis.keys(pattern);
    const artifacts = [];
    for (const key of keys) {
      const value = await this.redis.get(key);
      if (value) artifacts.push(JSON.parse(value));
    }
    return artifacts;
  }

  // === CONTEXT SHARING ===

  async shareContext(fromSessionId, toSessionId, keys) {
    for (const key of keys) {
      const value = await this.getSessionMemory(fromSessionId, key);
      if (value !== null) {
        await this.setSessionMemory(toSessionId, key, value);
      }
    }
  }

  // === CLEANUP ===

  async cleanupSession(sessionId) {
    const patterns = [
      `swarm:memory:${sessionId}:*`,
      `swarm:history:${sessionId}`,
      `swarm:artifact:${sessionId}:*`,
    ];
    for (const pattern of patterns) {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    }
  }

  async disconnect() {
    await this.redis.disconnect();
  }
}

let _store = null;

export async function getMemoryStore() {
  if (!_store) {
    _store = new MemoryStore();
    await _store.connect();
  }
  return _store;
}
