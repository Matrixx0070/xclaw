/**
 * Memory Store — in-process implementation (swarm unification, ADR 0004).
 *
 * Replaces the vendored Redis-backed store with Maps behind the same public
 * interface (session memory w/ TTL, facts, history, artifacts, context
 * sharing). Single-process gateway — see task-queue.mjs for the rationale.
 */
import { randomUUID } from "node:crypto";
import { nowISO } from "./utils.mjs";

const HISTORY_CAP = 1000;

export class MemoryStore {
  constructor() {
    /** @type {Map<string, Map<string, {value:any, expiresAt:number}>>} */
    this._sessions = new Map();
    /** @type {Map<string, object>} */
    this._facts = new Map();
    /** @type {Map<string, object[]>} */
    this._history = new Map();
    /** @type {Map<string, Map<string, object>>} */
    this._artifacts = new Map();
  }

  async connect() {
    console.log("[swarm-memory] in-process store ready");
  }

  _session(sessionId) {
    if (!this._sessions.has(sessionId)) this._sessions.set(sessionId, new Map());
    return this._sessions.get(sessionId);
  }

  // === SESSION MEMORY ===

  async setSessionMemory(sessionId, key, value, ttl = 3600) {
    this._session(sessionId).set(key, { value, expiresAt: Date.now() + ttl * 1000 });
  }

  async getSessionMemory(sessionId, key) {
    const entry = this._session(sessionId).get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this._session(sessionId).delete(key);
      return null;
    }
    return entry.value;
  }

  async deleteSessionMemory(sessionId, key) {
    this._session(sessionId).delete(key);
  }

  async getAllSessionMemory(sessionId) {
    const out = {};
    const now = Date.now();
    for (const [key, entry] of this._session(sessionId)) {
      if (entry.expiresAt >= now) out[key] = entry.value;
    }
    return out;
  }

  // === FACTS ===

  async storeFact(fact, metadata = {}) {
    const id = randomUUID();
    this._facts.set(id, { id, fact, metadata, createdAt: nowISO(), accessCount: 0 });
    return id;
  }

  async getFact(id) {
    const entry = this._facts.get(id);
    if (!entry) return null;
    entry.accessCount = (entry.accessCount || 0) + 1;
    return entry;
  }

  async searchFacts(query, limit = 10) {
    const q = String(query || "").toLowerCase();
    const out = [];
    for (const entry of this._facts.values()) {
      const hay = `${entry.fact} ${JSON.stringify(entry.metadata)}`.toLowerCase();
      if (hay.includes(q)) out.push(entry);
      if (out.length >= limit) break;
    }
    return out;
  }

  // === HISTORY ===

  async appendToHistory(sessionId, entry) {
    if (!this._history.has(sessionId)) this._history.set(sessionId, []);
    const list = this._history.get(sessionId);
    list.unshift({ ...entry, _at: nowISO() });
    if (list.length > HISTORY_CAP) list.length = HISTORY_CAP;
  }

  async getHistory(sessionId, limit = 100) {
    return (this._history.get(sessionId) || []).slice(0, limit);
  }

  async clearHistory(sessionId) {
    this._history.delete(sessionId);
  }

  // === ARTIFACTS ===

  async storeArtifact(sessionId, artifact) {
    const id = randomUUID();
    if (!this._artifacts.has(sessionId)) this._artifacts.set(sessionId, new Map());
    this._artifacts.get(sessionId).set(id, { ...artifact, id, createdAt: nowISO() });
    return id;
  }

  async getArtifact(sessionId, id) {
    return this._artifacts.get(sessionId)?.get(id) || null;
  }

  async getAllArtifacts(sessionId) {
    return [...(this._artifacts.get(sessionId)?.values() || [])];
  }

  // === CONTEXT SHARING ===

  async shareContext(fromSessionId, toSessionId, keys) {
    let shared = 0;
    for (const key of keys || []) {
      const value = await this.getSessionMemory(fromSessionId, key);
      if (value !== null) {
        await this.setSessionMemory(toSessionId, key, value);
        shared += 1;
      }
    }
    return shared;
  }

  // === MAINTENANCE ===

  async cleanupSession(sessionId) {
    this._sessions.delete(sessionId);
    this._history.delete(sessionId);
    this._artifacts.delete(sessionId);
  }

  async disconnect() {
    this._sessions.clear();
    this._facts.clear();
    this._history.clear();
    this._artifacts.clear();
  }
}

let _instance = null;

export async function getMemoryStore() {
  if (!_instance) {
    _instance = new MemoryStore();
    await _instance.connect();
  }
  return _instance;
}

export function resetMemoryStore() {
  _instance = null;
}

export default { MemoryStore, getMemoryStore, resetMemoryStore };
