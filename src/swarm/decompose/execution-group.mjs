/**
 * Execution Group — Manages parallel execution of sub-agent batches
 * Handles concurrency limits, error isolation, result collection
 * Integrates with Piscina for worker thread pools
 */
import { getConfig } from "./config.mjs";
import { nowISO, sleep } from "./utils.mjs";

export class ExecutionGroup {
  constructor(groupId, tasks, options = {}) {
    this.groupId = groupId;
    this.tasks = tasks;
    this.parallel = options.parallel !== false;
    this.maxConcurrency = options.maxConcurrency || getConfig().swarm.subAgent.maxConcurrent;
    this.timeoutMs = (options.timeoutSeconds || 300) * 1000;
    this.retryAttempts = options.retryAttempts || 3;
    this.results = new Map();
    this.errors = new Map();
    this.running = new Set();
    this.completed = new Set();
    this.startedAt = null;
    this.completedAt = null;
  }

  async execute(executeFn, onProgress = null) {
    this.startedAt = nowISO();
    console.log(`[swarm-eg] Group ${this.groupId} starting: ${this.tasks.length} tasks, parallel: ${this.parallel}`);

    if (!this.parallel || this.tasks.length === 1) {
      // Sequential execution
      for (const task of this.tasks) {
        await this._executeSingle(task, executeFn, onProgress);
      }
    } else {
      // Parallel execution with concurrency limit
      await this._executeParallel(executeFn, onProgress);
    }

    this.completedAt = nowISO();
    const duration = new Date(this.completedAt) - new Date(this.startedAt);
    console.log(`[swarm-eg] Group ${this.groupId} completed in ${duration}ms`);

    return {
      groupId: this.groupId,
      results: Object.fromEntries(this.results),
      errors: Object.fromEntries(this.errors),
      completed: this.completed.size,
      failed: this.errors.size,
      durationMs: duration,
    };
  }

  async _executeSingle(task, executeFn, onProgress) {
    this.running.add(task.taskId);

    try {
      const result = await this._withTimeout(
        this._withRetry(() => executeFn(task), this.retryAttempts),
        this.timeoutMs
      );

      this.results.set(task.taskId, result);
      this.completed.add(task.taskId);

      if (onProgress) {
        onProgress({
          taskId: task.taskId,
          status: "completed",
          groupId: this.groupId,
          result: result,
        });
      }
    } catch (e) {
      this.errors.set(task.taskId, e.message);

      if (onProgress) {
        onProgress({
          taskId: task.taskId,
          status: "failed",
          groupId: this.groupId,
          error: e.message,
        });
      }
    } finally {
      this.running.delete(task.taskId);
    }
  }

  async _executeParallel(executeFn, onProgress) {
    const semaphore = new Semaphore(this.maxConcurrency);
    const promises = [];

    for (const task of this.tasks) {
      const promise = (async () => {
        await semaphore.acquire();
        try {
          await this._executeSingle(task, executeFn, onProgress);
        } finally {
          semaphore.release();
        }
      })();
      promises.push(promise);
    }

    await Promise.all(promises);
  }

  async _withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Execution timeout after ${ms}ms`));
      }, ms);

      promise
        .then((result) => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timeout);
          reject(err);
        });
    });
  }

  async _withRetry(fn, maxAttempts) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (e) {
        lastError = e;
        if (attempt < maxAttempts) {
          const delay = Math.pow(2, attempt - 1) * 1000;
          console.warn(`[swarm-eg] Retry ${attempt}/${maxAttempts} after ${delay}ms: ${e.message}`);
          await sleep(delay);
        }
      }
    }
    throw lastError;
  }

  getProgress() {
    return {
      groupId: this.groupId,
      total: this.tasks.length,
      completed: this.completed.size,
      running: this.running.size,
      failed: this.errors.size,
      pending: this.tasks.length - this.completed.size - this.running.size,
      percentComplete: Math.round((this.completed.size / this.tasks.length) * 100),
    };
  }

  isComplete() {
    return this.completed.size + this.errors.size >= this.tasks.length;
  }
}

// Semaphore for concurrency control
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

export class ExecutionGroupManager {
  constructor() {
    this.groups = new Map();
    this.activeGroups = new Set();
  }

  createGroup(groupId, tasks, options = {}) {
    const group = new ExecutionGroup(groupId, tasks, options);
    this.groups.set(groupId, group);
    return group;
  }

  async executeGroups(groups, executeFn, onProgress = null) {
    const results = [];
    for (const group of groups) {
      this.activeGroups.add(group.groupId);
      const result = await group.execute(executeFn, onProgress);
      this.activeGroups.delete(group.groupId);
      results.push(result);
    }
    return results;
  }

  getActiveGroups() {
    return Array.from(this.activeGroups);
  }

  getGroupProgress(groupId) {
    const group = this.groups.get(groupId);
    return group ? group.getProgress() : null;
  }

  getAllProgress() {
    const progress = {};
    for (const [id, group] of this.groups) {
      progress[id] = group.getProgress();
    }
    return progress;
  }
}
