/**
 * Receipt Generator — Creates XClaw-compatible execution receipts
 * Tracks every step, tool call, token usage, and decision
 */
import { nowISO } from "../utils.mjs";

export class ReceiptGenerator {
  constructor() {
    this.receipts = new Map();
  }

  create(taskId, plan) {
    const receipt = {
      taskId,
      status: "pending",
      createdAt: nowISO(),
      startedAt: null,
      completedAt: null,
      plan: {
        reasoning: plan.reasoning,
        estimatedSubAgents: plan.estimatedSubAgents,
        estimatedDurationSeconds: plan.estimatedDurationSeconds,
        estimatedTokens: plan.estimatedTokens,
      },
      steps: [],
      toolsUsed: [],
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
      durationMs: 0,
      diffs: [],
      mergePolicy: "llm",
      confidenceScore: 0,
      executionGroups: [],
      errors: [],
      version: "1.0",
    };
    this.receipts.set(taskId, receipt);
    return receipt;
  }

  addStep(taskId, step) {
    const receipt = this.receipts.get(taskId);
    if (!receipt) return;

    receipt.steps.push({
      agentId: step.agentId,
      role: step.role,
      description: step.description,
      status: step.status,
      tools: step.tools || [],
      resultPreview: step.resultPreview,
      error: step.error,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      tokenUsage: step.tokenUsage || {},
      durationMs: step.durationMs,
    });

    // Aggregate tools
    for (const tool of step.tools || []) {
      if (!receipt.toolsUsed.includes(tool)) {
        receipt.toolsUsed.push(tool);
      }
    }

    // Aggregate tokens
    if (step.tokenUsage) {
      receipt.tokenUsage.prompt += step.tokenUsage.prompt || 0;
      receipt.tokenUsage.completion += step.tokenUsage.completion || 0;
      receipt.tokenUsage.total += (step.tokenUsage.prompt || 0) + (step.tokenUsage.completion || 0);
    }
  }

  addDiff(taskId, diff) {
    const receipt = this.receipts.get(taskId);
    if (!receipt) return;
    receipt.diffs.push({
      ...diff,
      timestamp: nowISO(),
    });
  }

  addError(taskId, error) {
    const receipt = this.receipts.get(taskId);
    if (!receipt) return;
    receipt.errors.push({
      message: error.message || String(error),
      stack: error.stack,
      timestamp: nowISO(),
    });
  }

  finalize(taskId, data = {}) {
    const receipt = this.receipts.get(taskId);
    if (!receipt) return null;

    receipt.status = data.status || "done";
    receipt.completedAt = nowISO();
    receipt.durationMs = data.durationMs || 0;
    receipt.mergePolicy = data.mergePolicy || "llm";
    receipt.confidenceScore = data.confidenceScore || 0;
    receipt.executionGroups = data.executionGroups || [];

    return receipt;
  }

  getReceipt(taskId) {
    return this.receipts.get(taskId);
  }

  exportReceipt(taskId) {
    const receipt = this.receipts.get(taskId);
    if (!receipt) return null;
    return JSON.parse(JSON.stringify(receipt));
  }
}
