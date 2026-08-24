/**
 * Budget Tracker Tests
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { BudgetTracker } from "../src/swarm/decompose/budget-tracker.mjs";

describe("BudgetTracker", () => {
  it("should initialize with defaults", () => {
    const bt = new BudgetTracker("test-session");
    assert.strictEqual(bt.sessionId, "test-session");
    assert.strictEqual(bt.enabled, false);
  });

  it("should track token usage", () => {
    const bt = new BudgetTracker("s1", { maxTokens: 1000, enabled: true });
    bt.recordUsage(500, 0.01);
    const summary = bt.getSummary();
    assert.strictEqual(summary.totalTokens, 500);
    assert.strictEqual(summary.costEstimate, 0.01);
  });

  it("should alert when threshold exceeded", () => {
    const bt = new BudgetTracker("s1", { maxTokens: 1000, alertThreshold: 0.5, enabled: true });
    let alerted = false;
    bt.onAlert = () => { alerted = true; };
    bt.recordUsage(600, 0.02);
    assert.strictEqual(alerted, true);
  });

  it("should estimate cost correctly", () => {
    const bt = new BudgetTracker("s1");
    const cost = bt.estimateCost(1000, "openai/gpt-4o");
    assert.strictEqual(typeof cost, "number");
    assert.ok(cost > 0);
  });
});
