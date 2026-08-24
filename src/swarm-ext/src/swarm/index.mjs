/**
 * XClaw Agent Swarm — Main Entry Point
 * Export all components for integration
 */
// Core
export { Orchestrator } from "./orchestrator.mjs";
export { SubAgent, SubAgentPool } from "./sub-agent.mjs";
export { TaskQueue, getTaskQueue } from "./task-queue.mjs";
export { ResultAggregator } from "./result-aggregator.mjs";
export { ContextSharder } from "./context-sharder.mjs";
export { DAGEngine } from "./dag-engine.mjs";
export { ExecutionGroup, ExecutionGroupManager } from "./execution-group.mjs";

// Management
export { getSessionManager } from "./session-manager.mjs";
export { getMemoryStore } from "./memory-store.mjs";
export { BudgetTracker } from "./budget-tracker.mjs";
export { getWatchdog } from "./watchdog.mjs";
export { HeartbeatService } from "./heartbeat-service.mjs";

// Training
export { PARLTrainer } from "./parl-trainer.mjs";
export { RewardModel } from "./reward-model.mjs";

// Plugins
export { PluginLoader, loadPlugins } from "./plugin-loader.mjs";
export { PluginRegistry, getRegistry } from "./plugin-registry.mjs";
export { ToolPolicy } from "./tool-policy.mjs";

// MCP
export { MCPGateway, McpConnectionPool, McpToolPromoter } from "./mcp-gateway.mjs";

// Merge
export { LLMMerge } from "./merge/llm-merge.mjs";
export { ConcatMerge } from "./merge/concat-merge.mjs";
export { VoteMerge } from "./merge/vote-merge.mjs";
export { QuorumMerge } from "./merge/quorum-merge.mjs";

// Receipt
export { ReceiptGenerator } from "./receipt/generator.mjs";
export { ReceiptValidator } from "./receipt/validator.mjs";
export { DiffEngine } from "./receipt/diff-engine.mjs";
export { ReceiptMerger } from "./receipt/merger.mjs";

// Computer
export { BashTool } from "./computer/bash.mjs";
export { FilesTool } from "./computer/files.mjs";
export { BrowserTool } from "./computer/browser.mjs";
export { ScreenTool } from "./computer/screen.mjs";

// Utils
export { getConfig, loadConfig, setConfig, getSwarmConfig } from "./config.mjs";
export { getSwarmHealth } from "./health.mjs";
export * from "./schemas.mjs";
export * from "./utils.mjs";
export * from "./prompts.mjs";
