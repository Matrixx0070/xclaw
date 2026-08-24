/**
 * Task Queue — in-process implementation (swarm unification, ADR 0004).
 *
 * Replaces the vendored Redis-backed queue: xclaw's gateway is a single
 * process, so priority queues, delayed tasks, DLQ, progress pub/sub and the
 * result store are plain Maps + an EventEmitter behind the SAME public
 * interface the orchestrator/routes already use. This removed the ioredis
 * dependency and the external-Redis deployment requirement entirely.
 * If multi-process swarm ever becomes real, reintroduce a broker behind
 * this interface — callers never see the backend.
 */
import { EventEmitter } from "node:events";
import { nowISO } from "./utils.mjs";

export class TaskQueue {
  constructor() {
    this.maxRetries = 3;
    this.retryDelay = 5000;
    /** @type {Map<string, Array<{score:number, task:object}>>} */
    this._queues = new Map();
    /** @type {Map<string, Array<{executeAt:number, task:object}>>} */
    this._delayed = new Map();
    /** @type {Map<string, Array<object>>} */
    this._dlq = new Map();
    /** @type {Map<string, {result:object, expiresAt:number}>} */
    this._results = new Map();
    this._events = new EventEmitter();
    this._events.setMaxListeners(200);
    this._connected = false;
  }

  async connect() {
    this._connected = true;
    console.log("[swarm-queue] in-process queue ready");
  }

  _q(parentTaskId) {
    if (!this._queues.has(parentTaskId)) this._queues.set(parentTaskId, []);
    return this._queues.get(parentTaskId);
  }

  // === CORE QUEUE OPERATIONS ===

  async enqueue(task, priority = 5) {
    const entry = {
      score: Date.now() + (10 - priority) * 1000,
      task: { ...task, _enqueuedAt: nowISO(), _retryCount: task._retryCount || 0 },
    };
    const q = this._q(task.parentTaskId);
    q.push(entry);
    q.sort((a, b) => a.score - b.score);
    return task.taskId;
  }

  async dequeue(parentTaskId) {
    const q = this._q(parentTaskId);
    const entry = q.shift();
    return entry ? entry.task : null;
  }

  async dequeueBatch(parentTaskId, count = 10) {
    const q = this._q(parentTaskId);
    return q.splice(0, count).map((e) => e.task);
  }

  async enqueueDelayed(task, delayMs) {
    if (!this._delayed.has(task.parentTaskId)) this._delayed.set(task.parentTaskId, []);
    this._delayed.get(task.parentTaskId).push({ executeAt: Date.now() + delayMs, task });
  }

  async processDelayed(parentTaskId) {
    const list = this._delayed.get(parentTaskId) || [];
    const now = Date.now();
    const ready = list.filter((e) => e.executeAt <= now);
    this._delayed.set(parentTaskId, list.filter((e) => e.executeAt > now));
    for (const e of ready) await this.enqueue(e.task);
    return ready.length;
  }

  // === DEAD LETTER QUEUE ===

  async moveToDLQ(task, error) {
    if (!this._dlq.has(task.parentTaskId)) this._dlq.set(task.parentTaskId, []);
    this._dlq.get(task.parentTaskId).unshift({
      task,
      error: error.message || String(error),
      failedAt: nowISO(),
    });
    console.log(`[swarm-queue] Task ${task.taskId} moved to DLQ:`, error.message || error);
  }

  async getDLQ(parentTaskId) {
    return [...(this._dlq.get(parentTaskId) || [])];
  }

  async retryFromDLQ(parentTaskId, taskId) {
    const list = this._dlq.get(parentTaskId) || [];
    const i = list.findIndex((e) => e.task.taskId === taskId);
    if (i === -1) return false;
    const [entry] = list.splice(i, 1);
    entry.task._retryCount = (entry.task._retryCount || 0) + 1;
    await this.enqueue(entry.task);
    return true;
  }

  // === PROGRESS PUB/SUB ===

  async publishProgress(taskId, data) {
    this._events.emit(`progress:${taskId}`, { ...data, _timestamp: nowISO() });
  }

  async subscribeProgress(taskId, callback) {
    const event = `progress:${taskId}`;
    const handler = (msg) => callback(msg);
    this._events.on(event, handler);
    return {
      unsubscribe: async () => {
        this._events.off(event, handler);
      },
    };
  }

  // === RESULT STORE ===

  async storeResult(taskId, result, ttl = 3600) {
    this._results.set(taskId, { result, expiresAt: Date.now() + ttl * 1000 });
  }

  async getResult(taskId) {
    const entry = this._results.get(taskId);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this._results.delete(taskId);
      return null;
    }
    return entry.result;
  }

  // === METRICS / MAINTENANCE ===

  async getQueueLength(parentTaskId) {
    return this._q(parentTaskId).length;
  }

  async getQueueMetrics(parentTaskId) {
    return {
      queued: this._q(parentTaskId).length,
      delayed: (this._delayed.get(parentTaskId) || []).length,
      dlq: (this._dlq.get(parentTaskId) || []).length,
    };
  }

  async clearQueue(parentTaskId) {
    this._queues.delete(parentTaskId);
    this._delayed.delete(parentTaskId);
    this._dlq.delete(parentTaskId);
  }

  async enqueueBatch(tasks, priority = 5) {
    for (const t of tasks) await this.enqueue(t, priority);
    return tasks.map((t) => t.taskId);
  }

  async disconnect() {
    this._connected = false;
    this._events.removeAllListeners();
  }

  async ping() {
    return this._connected ? "PONG" : null;
  }
}

let _instance = null;

export async function getTaskQueue() {
  if (!_instance) {
    _instance = new TaskQueue();
    await _instance.connect();
  }
  return _instance;
}

export function resetTaskQueue() {
  _instance = null;
}

export function setTaskQueue(queue) {
  _instance = queue;
}

export default { TaskQueue, getTaskQueue, resetTaskQueue, setTaskQueue };
