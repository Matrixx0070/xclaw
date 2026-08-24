/**
 * Budget Tracker — Monitors and enforces token/cost budgets per task/session
 * Prevents runaway token consumption
 */
import { getConfig } from "./config.mjs";

export class BudgetTracker {
  constructor(sessionId, options = {}) {
    this.sessionId = sessionId;
    this.config = getConfig().swarm.budget;
    // Vendor bug: constructor options `enabled`/`alertThreshold` were ignored
    // (the shipped tests expect them to be honored).
    this.enabled = options.enabled ?? this.config.enabled;
    this.maxTokens = options.maxTokens || this.config.maxTokensPerTask;
    this.maxCost = options.maxCost || this.config.maxCostPerTask;
    this.alertThreshold = options.alertThreshold ?? this.config.alertThreshold;
    /** Optional alert hook: onAlert({ level, message, ... }) */
    this.onAlert = null;
    this.tokensUsed = 0;
    this.costEstimate = 0;
    this.history = [];
  }

  recordUsage(tokens, cost = 0, metadata = {}) {
    if (!this.enabled) return { ok: true };

    this.tokensUsed += tokens;
    this.costEstimate += cost;

    this.history.push({
      tokens,
      cost,
      timestamp: new Date().toISOString(),
      ...metadata,
    });

    const tokenRatio = this.tokensUsed / this.maxTokens;
    const costRatio = this.costEstimate / this.maxCost;
    const maxRatio = Math.max(tokenRatio, costRatio);

    // Check hard limits
    if (tokenRatio >= 1) {
      const out = {
        ok: false,
        reason: "token_limit_exceeded",
        tokensUsed: this.tokensUsed,
        maxTokens: this.maxTokens,
        ratio: tokenRatio,
      };
      this.onAlert?.({ level: "limit", ...out });
      return out;
    }

    if (costRatio >= 1) {
      const out = {
        ok: false,
        reason: "cost_limit_exceeded",
        costEstimate: this.costEstimate,
        maxCost: this.maxCost,
        ratio: costRatio,
      };
      this.onAlert?.({ level: "limit", ...out });
      return out;
    }

    // Check alert threshold
    if (maxRatio >= this.alertThreshold) {
      const out = {
        ok: true,
        warning: true,
        message: `Budget at ${Math.round(maxRatio * 100)}%`,
        tokensUsed: this.tokensUsed,
        costEstimate: this.costEstimate,
        ratio: maxRatio,
      };
      this.onAlert?.({ level: "warning", ...out });
      return out;
    }

    return { ok: true, tokensUsed: this.tokensUsed, costEstimate: this.costEstimate };
  }

  estimateCost(tokens, model) {
    // Rough cost estimates per 1K tokens
    const rates = {
      "gpt-4o": { input: 0.005, output: 0.015 },
      "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
      "xai/grok-4.5": { input: 0.003, output: 0.015 },
      "claude-3-5-sonnet": { input: 0.003, output: 0.015 },
      default: { input: 0.005, output: 0.015 },
    };

    const rate = rates[model] || rates.default;
    // Assume 2:1 input:output ratio
    return (tokens / 1000) * (rate.input * 0.67 + rate.output * 0.33);
  }

  getSummary() {
    return {
      enabled: this.enabled,
      tokensUsed: this.tokensUsed,
      totalTokens: this.tokensUsed,
      maxTokens: this.maxTokens,
      tokenRatio: this.tokensUsed / this.maxTokens,
      costEstimate: this.costEstimate,
      maxCost: this.maxCost,
      costRatio: this.costEstimate / this.maxCost,
      history: this.history,
    };
  }

  reset() {
    this.tokensUsed = 0;
    this.costEstimate = 0;
    this.history = [];
  }
}
