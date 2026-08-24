/**
 * Task Queue — Production-grade Redis-backed distributed queue
 * Features: priority queues, delayed tasks, dead letter queue, batch processing
 */
import Redis from "ioredis";
import { getConfig } from "./config.mjs";
import { nowISO } from "./utils.mjs";

export class TaskQueue {
  constructor() {
    const cfg = getConfig().swarm.taskQueue;
    this.brokerUrl = cfg.brokerUrl;
    this.resultBackend = cfg.resultBackend;
    this.maxRetries = cfg.maxRetries || 3;
    this.retryDelay = cfg.retryDelay || 5000;
    this._redis = null;
    this._subscriber = null;
  }

  async connect() {
    this._redis = new Redis(this.brokerUrl, {
      retryStrategy: (times) => Math.min(times * 100, 3000),
      maxRetriesPerRequest: 3,
    });
    this._redis.on("error", (err) => {
      console.error("[swarm-queue] Redis error:", err.message);
    });
    await this._redis.ping();
    console.log("[swarm-queue] Connected to", this.brokerUrl);
  }

  get redis() {
    if (!this._redis) throw new Error("TaskQueue not connected. Call connect() first.");
    return this._redis;
  }

  // === CORE QUEUE OPERATIONS ===

  async enqueue(task, priority = 5) {
    const taskData = JSON.stringify({
      ...task,
      _enqueuedAt: nowISO(),
      _retryCount: 0,
    });
    const queueKey = `swarm:queue:${task.parentTaskId}`;
    // Use priority scoring (lower number = higher priority)
    const score = Date.now() + (10 - priority) * 1000;
    await this.redis.zadd(queueKey, score, taskData);
    await this.redis.expire(queueKey, 86400);
    console.log(`[swarm-queue] Enqueued task ${task.taskId} (priority: ${priority})`);
    return task.taskId;
  }

  async dequeue(parentTaskId, timeout = 5) {
    const queueKey = `swarm:queue:${parentTaskId}`;
    // Pop highest priority (lowest score) task
    const result = await this.redis.zpopmin(queueKey);
    if (result && result.length > 0) {
      return JSON.parse(result[0]);
    }
    return null;
  }

  async dequeueBatch(parentTaskId, count = 10) {
    const queueKey = `swarm:queue:${parentTaskId}`;
    const results = await this.redis.zrange(queueKey, 0, count - 1);
    if (results.length > 0) {
      await this.redis.zremrangebyrank(queueKey, 0, results.length - 1);
    }
    return results.map((r) => JSON.parse(r));
  }

  // === DELAYED TASKS ===

  async enqueueDelayed(task, delayMs) {
    const delayedKey = `swarm:delayed:${task.parentTaskId}`;
    const executeAt = Date.now() + delayMs;
    await this.redis.zadd(delayedKey, executeAt, JSON.stringify(task));
    await this.redis.expire(delayedKey, 86400);
  }

  async processDelayed(parentTaskId) {
    const delayedKey = `swarm:delayed:${parentTaskId}`;
    const now = Date.now();
    const ready = await this.redis.zrangebyscore(delayedKey, 0, now);
    if (ready.length > 0) {
      await this.redis.zremrangebyscore(delayedKey, 0, now);
      for (const taskData of ready) {
        const task = JSON.parse(taskData);
        await this.enqueue(task);
      }
    }
    return ready.length;
  }

  // === DEAD LETTER QUEUE ===

  async moveToDLQ(task, error) {
    const dlqKey = `swarm:dlq:${task.parentTaskId}`;
    const entry = {
      task,
      error: error.message || String(error),
      failedAt: nowISO(),
    };
    await this.redis.lpush(dlqKey, JSON.stringify(entry));
    await this.redis.expire(dlqKey, 604800); // 7 days
    console.log(`[swarm-queue] Task ${task.taskId} moved to DLQ:`, error.message);
  }

  async getDLQ(parentTaskId) {
    const dlqKey = `swarm:dlq:${parentTaskId}`;
    const entries = await this.redis.lrange(dlqKey, 0, -1);
    return entries.map((e) => JSON.parse(e));
  }

  async retryFromDLQ(parentTaskId, taskId) {
    const dlqKey = `swarm:dlq:${parentTaskId}`;
    const entries = await this.redis.lrange(dlqKey, 0, -1);
    for (const entry of entries) {
      const parsed = JSON.parse(entry);
      if (parsed.task.taskId === taskId) {
        parsed.task._retryCount = (parsed.task._retryCount || 0) + 1;
        await this.enqueue(parsed.task);
        await this.redis.lrem(dlqKey, 0, entry);
        return true;
      }
    }
    return false;
  }

  // === PROGRESS PUB/SUB ===

  async publishProgress(taskId, data) {
    const channel = `swarm:progress:${taskId}`;
    await this.redis.publish(channel, JSON.stringify({ ...data, _timestamp: nowISO() }));
  }

  async subscribeProgress(taskId, callback) {
    if (!this._subscriber) {
      this._subscriber = new Redis(this.brokerUrl);
    }
    const channel = `swarm:progress:${taskId}`;
    await this._subscriber.subscribe(channel);
    this._subscriber.on("message", (ch, message) => {
      if (ch === channel) {
        callback(JSON.parse(message));
      }
    });
    return {
      unsubscribe: async () => {
        await this._subscriber.unsubscribe(channel);
      },
    };
  }

  // === RESULT STORAGE ===

  async storeResult(taskId, result, ttl = 3600) {
    const key = `swarm:result:${taskId}`;
    await this.redis.setex(key, ttl, JSON.stringify(result));
  }

  async getResult(taskId) {
    const key = `swarm:result:${taskId}`;
    const result = await this.redis.get(key);
    return result ? JSON.parse(result) : null;
  }

  // === QUEUE METRICS ===

  async getQueueLength(parentTaskId) {
    const queueKey = `swarm:queue:${parentTaskId}`;
    return await this.redis.zcard(queueKey);
  }

  async getQueueMetrics(parentTaskId) {
    const queueKey = `swarm:queue:${parentTaskId}`;
    const delayedKey = `swarm:delayed:${parentTaskId}`;
    const dlqKey = `swarm:dlq:${parentTaskId}`;

    const [pending, delayed, dead] = await Promise.all([
      this.redis.zcard(queueKey),
      this.redis.zcard(delayedKey),
      this.redis.llen(dlqKey),
    ]);

    return { pending, delayed, dead, total: pending + delayed + dead };
  }

  async clearQueue(parentTaskId) {
    const keys = [
      `swarm:queue:${parentTaskId}`,
      `swarm:delayed:${parentTaskId}`,
      `swarm:dlq:${parentTaskId}`,
    ];
    for (const key of keys) {
      await this.redis.del(key);
    }
  }

  // === BATCH OPERATIONS ===

  async enqueueBatch(tasks, priority = 5) {
    const pipeline = this.redis.pipeline();
    for (const task of tasks) {
      const taskData = JSON.stringify({ ...task, _enqueuedAt: nowISO(), _retryCount: 0 });
      const score = Date.now() + (10 - priority) * 1000;
      pipeline.zadd(`swarm:queue:${task.parentTaskId}`, score, taskData);
    }
    await pipeline.exec();
    console.log(`[swarm-queue] Batch enqueued ${tasks.length} tasks`);
  }

  // === CLEANUP ===

  async disconnect() {
    if (this._redis) {
      await this._redis.disconnect();
      this._redis = null;
    }
    if (this._subscriber) {
      await this._subscriber.disconnect();
      this._subscriber = null;
    }
  }
}

// === GLOBAL INSTANCE ===
let _queue = null;

export async function getTaskQueue() {
  if (!_queue) {
    _queue = new TaskQueue();
    await _queue.connect();
  }
  return _queue;
}

export function resetTaskQueue() {
  _queue = null;
}

export function setTaskQueue(queue) {
  _queue = queue;
}
