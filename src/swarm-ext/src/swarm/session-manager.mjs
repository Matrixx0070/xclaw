/**
 * Session Manager — Manages swarm sessions with isolation and persistence
 * Maps to XClaw's session model with full state tracking
 */
import { getConfig } from "./config.mjs";
import { generateTaskId, nowISO } from "./utils.mjs";

export class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.taskToSession = new Map();
    this.config = getConfig().swarm;
  }

  createSession(options = {}) {
    const sessionId = options.sessionId || `sess_${generateTaskId().slice(5)}`;
    const session = {
      id: sessionId,
      profile: options.profile || "lab",
      createdAt: nowISO(),
      updatedAt: nowISO(),
      tasks: new Map(),
      activeTasks: new Set(),
      completedTasks: new Set(),
      failedTasks: new Set(),
      metadata: options.metadata || {},
      context: {
        files: options.contextFiles || [],
        history: options.history || [],
        computerState: options.computerState || {},
      },
      budget: {
        tokensUsed: 0,
        costEstimate: 0,
        maxTokens: this.config.budget.maxTokensPerTask,
        maxCost: this.config.budget.maxCostPerTask,
      },
      settings: {
        autoApprove: options.autoApprove !== false,
        mergePolicy: options.mergePolicy || this.config.mergePolicy,
        maxSubAgents: options.maxSubAgents || this.config.orchestrator.maxSubAgents,
      },
    };

    this.sessions.set(sessionId, session);
    console.log(`[swarm-session] Created session ${sessionId} (profile: ${session.profile})`);
    return session;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  hasSession(sessionId) {
    return this.sessions.has(sessionId);
  }

  registerTask(sessionId, taskId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.tasks.set(taskId, {
      taskId,
      status: "pending",
      createdAt: nowISO(),
    });
    session.activeTasks.add(taskId);
    this.taskToSession.set(taskId, sessionId);
    return true;
  }

  updateTaskStatus(sessionId, taskId, status, data = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const task = session.tasks.get(taskId);
    if (!task) return false;

    task.status = status;
    task.updatedAt = nowISO();
    Object.assign(task, data);

    if (status === "completed") {
      session.activeTasks.delete(taskId);
      session.completedTasks.add(taskId);
    } else if (status === "failed" || status === "cancelled") {
      session.activeTasks.delete(taskId);
      session.failedTasks.add(taskId);
    }

    session.updatedAt = nowISO();
    return true;
  }

  getSessionTasks(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return Array.from(session.tasks.values());
  }

  getSessionStats(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      id: session.id,
      profile: session.profile,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      totalTasks: session.tasks.size,
      activeTasks: session.activeTasks.size,
      completedTasks: session.completedTasks.size,
      failedTasks: session.failedTasks.size,
      budget: session.budget,
      settings: session.settings,
    };
  }

  updateBudget(sessionId, tokens, cost) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.budget.tokensUsed += tokens;
    session.budget.costEstimate += cost;

    // Check budget thresholds
    const tokenRatio = session.budget.tokensUsed / session.budget.maxTokens;
    const costRatio = session.budget.costEstimate / session.budget.maxCost;

    if (tokenRatio > 1 || costRatio > 1) {
      console.warn(`[swarm-session] Session ${sessionId} budget exceeded!`);
      return { exceeded: true, tokenRatio, costRatio };
    }

    if (tokenRatio > this.config.budget.alertThreshold || costRatio > this.config.budget.alertThreshold) {
      console.warn(`[swarm-session] Session ${sessionId} budget at ${Math.round(Math.max(tokenRatio, costRatio) * 100)}%`);
    }

    return { exceeded: false, tokenRatio, costRatio };
  }

  closeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    // Cancel all active tasks
    for (const taskId of session.activeTasks) {
      this.updateTaskStatus(sessionId, taskId, "cancelled", { reason: "session_closed" });
    }

    session.updatedAt = nowISO();
    console.log(`[swarm-session] Closed session ${sessionId}`);
    return true;
  }

  deleteSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    this.closeSession(sessionId);

    // Clean up task mappings
    for (const taskId of session.tasks.keys()) {
      this.taskToSession.delete(taskId);
    }

    this.sessions.delete(sessionId);
    console.log(`[swarm-session] Deleted session ${sessionId}`);
    return true;
  }

  getSessionByTask(taskId) {
    const sessionId = this.taskToSession.get(taskId);
    return sessionId ? this.sessions.get(sessionId) : null;
  }

  listSessions() {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      profile: s.profile,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      totalTasks: s.tasks.size,
      activeTasks: s.activeTasks.size,
    }));
  }

  // === PERSISTENCE ===

  async exportSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      ...session,
      tasks: Array.from(session.tasks.entries()),
      activeTasks: Array.from(session.activeTasks),
      completedTasks: Array.from(session.completedTasks),
      failedTasks: Array.from(session.failedTasks),
    };
  }

  async importSession(data) {
    const session = {
      ...data,
      tasks: new Map(data.tasks),
      activeTasks: new Set(data.activeTasks),
      completedTasks: new Set(data.completedTasks),
      failedTasks: new Set(data.failedTasks),
    };

    this.sessions.set(session.id, session);

    for (const [taskId] of session.tasks) {
      this.taskToSession.set(taskId, session.id);
    }

    return session;
  }
}

// Global instance
let _manager = null;

export function getSessionManager() {
  if (!_manager) {
    _manager = new SessionManager();
  }
  return _manager;
}
