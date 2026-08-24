/**
 * Zod schemas for Agent Swarm — Production-grade validation
 * Matches XClaw's strict validation patterns
 */
import { z } from "zod";

// === ENUMS ===
export const TaskStatus = z.enum([
  "pending", "analyzing", "spawning", "running",
  "aggregating", "completed", "failed", "cancelled",
]);

export const AgentRole = z.enum([
  "orchestrator", "researcher", "coder", "analyst",
  "fact_checker", "writer", "browser", "custom",
]);

export const ToolType = z.enum([
  "web_search", "code_executor", "browser",
  "file_reader", "calculator", "custom",
]);

export const MergeMode = z.enum([
  "llm", "concat", "vote", "quorum",
]);

export const SandboxType = z.enum([
  "docker", "process", "none",
]);

// === SUBTASK ===
export const SubTask = z.object({
  taskId: z.string(),
  parentTaskId: z.string(),
  agentRole: AgentRole.default("researcher"),
  agentId: z.string().optional(),
  description: z.string(),
  toolsNeeded: z.array(ToolType).default([]),
  context: z.record(z.any()).default({}),
  dependencies: z.array(z.string()).default([]),
  priority: z.number().min(1).max(10).default(5),
  maxSteps: z.number().min(1).max(100).default(10),
  timeoutSeconds: z.number().min(1).max(3600).default(300),
  status: TaskStatus.default("pending"),
  result: z.record(z.any()).optional(),
  error: z.string().optional(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  tokenUsage: z.record(z.number()).default({}),
  toolCalls: z.array(z.record(z.any())).default([]),
});

// === ORCHESTRATOR PLAN ===
export const OrchestratorPlan = z.object({
  taskId: z.string(),
  originalQuery: z.string(),
  decomposedTasks: z.array(SubTask).default([]),
  estimatedSubAgents: z.number().default(0),
  estimatedDurationSeconds: z.number().default(0),
  estimatedTokens: z.number().default(0),
  reasoning: z.string().default(""),
  executionGroups: z.array(z.object({
    groupId: z.string(),
    tasks: z.array(z.string()),
    parallel: z.boolean().default(true),
  })).default([]),
});

// === TASK REQUEST ===
export const TaskRequest = z.object({
  query: z.string().min(1).max(100000),
  maxSubAgents: z.number().min(1).max(300).optional(),
  timeoutSeconds: z.number().min(1).max(7200).optional(),
  outputFormat: z.enum(["json", "markdown", "html", "code", "txt"]).optional(),
  contextFiles: z.array(z.string()).optional(),
  priority: z.number().min(1).max(10).default(5),
  metadata: z.record(z.any()).default({}),
  mergePolicy: z.object({
    mode: MergeMode.optional(),
    autoMerge: z.boolean().optional(),
    requireApproval: z.boolean().optional(),
    confidenceThreshold: z.number().min(0).max(1).optional(),
  }).optional(),
});

// === TASK RESPONSE ===
export const TaskResponse = z.object({
  taskId: z.string(),
  status: TaskStatus,
  plan: OrchestratorPlan.optional(),
  subTasks: z.array(SubTask).default([]),
  finalResult: z.record(z.any()).optional(),
  artifacts: z.array(z.record(z.any())).default([]),
  executionLog: z.array(z.record(z.any())).default([]),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  durationSeconds: z.number().optional(),
  tokensUsed: z.record(z.number()).default({}),
  costEstimate: z.number().optional(),
  error: z.string().optional(),
});

// === TOOL CALL ===
export const ToolCall = z.object({
  toolName: z.string(),
  params: z.record(z.any()).default({}),
  callId: z.string().default(() => `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
  result: z.any().optional(),
  error: z.string().optional(),
  latencyMs: z.number().optional(),
  retryCount: z.number().default(0),
});

// === AGENT CONTEXT ===
export const AgentContext = z.object({
  taskId: z.string(),
  sharedMemory: z.record(z.any()).default({}),
  conversationHistory: z.array(z.record(z.string())).default([]),
  artifacts: z.array(z.record(z.any())).default([]),
  shardIndex: z.number().optional(),
  totalShards: z.number().optional(),
});

// === PLUGIN MANIFEST ===
export const PluginManifest = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  keywords: z.array(z.string()).default([]),
  author: z.string().default(""),
  homepage: z.string().default(""),
  license: z.string().default("MIT"),
  skills: z.string().default("./skills/"),
  skillInstructions: z.string().default(""),
  interface: z.record(z.any()).default({}),
  mcpServer: z.record(z.any()).optional(),
});

// === WEBSOCKET MESSAGE ===
export const WebSocketMessage = z.object({
  type: z.string(),
  taskId: z.string(),
  data: z.record(z.any()).default({}),
  timestamp: z.string().datetime().default(() => new Date().toISOString()),
});

// === PARL TRAINING SAMPLE ===
export const PARLTrainingSample = z.object({
  query: z.string(),
  plan: OrchestratorPlan,
  reward: z.number().min(0).max(100).default(0),
  executionTime: z.number().default(0),
  success: z.boolean().default(false),
  feedback: z.string().optional(),
  improvements: z.array(z.string()).default([]),
});

// === RECEIPT ===
export const Receipt = z.object({
  taskId: z.string(),
  status: z.enum(["pending", "running", "done", "error"]),
  steps: z.array(z.object({
    agentId: z.string(),
    role: z.string(),
    description: z.string(),
    status: z.string(),
    tools: z.array(z.string()).default([]),
    resultPreview: z.string().optional(),
    error: z.string().optional(),
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
    tokenUsage: z.record(z.number()).default({}),
  })).default([]),
  toolsUsed: z.array(z.string()).default([]),
  durationMs: z.number().default(0),
  tokenUsage: z.record(z.number()).default({}),
  diffs: z.array(z.record(z.any())).default([]),
  mergePolicy: z.string().default("llm"),
  confidenceScore: z.number().default(0),
});

// === XCLAW INTEGRATION ===
export const XClawGoalPayload = z.object({
  goal: z.string(),
  sessionId: z.string().default("unknown"),
  profile: z.enum(["lab", "dev", "prod"]).default("lab"),
  context: z.object({
    files: z.array(z.string()).optional(),
    history: z.array(z.any()).optional(),
    computerState: z.record(z.any()).optional(),
  }).default({}),
  constraints: z.object({
    maxSteps: z.number().optional(),
    autoApprove: z.boolean().optional(),
    egress: z.enum(["allow", "deny", "allowlist"]).optional(),
    maxSubAgents: z.number().optional(),
    timeoutSeconds: z.number().optional(),
  }).default({}),
});

export const XClawResponse = z.object({
  id: z.string(),
  status: z.enum(["pending", "running", "done", "error"]),
  result: z.object({
    summary: z.string(),
    content: z.string(),
    artifacts: z.array(z.record(z.any())).default([]),
    confidence: z.number().default(0),
  }).optional(),
  receipt: Receipt.optional(),
  swarm: z.object({
    subAgents: z.number().default(0),
    parallelRatio: z.number().default(0),
    planReasoning: z.string().default(""),
    executionGroups: z.array(z.record(z.any())).default([]),
  }).optional(),
  error: z.string().optional(),
});

// === MCP ===
export const McpServerConfig = z.object({
  id: z.string(),
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
  alwaysExpose: z.union([z.boolean(), z.array(z.string())]).default(true),
  timeout: z.number().default(30000),
});

export const McpToolPromotion = z.object({
  serverId: z.string(),
  toolNames: z.array(z.string()),
  sessionId: z.string(),
  promotedAt: z.string().datetime(),
});

// === BUDGET ===
export const BudgetConfig = z.object({
  enabled: z.boolean().default(false),
  maxTokensPerTask: z.number().default(1000000),
  maxCostPerTask: z.number().default(10.0),
  currency: z.string().default("USD"),
  alertThreshold: z.number().default(0.8),
});

// === HEALTH ===
export const HealthCheck = z.object({
  status: z.enum(["healthy", "degraded", "unhealthy"]),
  checks: z.record(z.boolean()),
  config: z.record(z.any()),
  timestamp: z.string().datetime(),
});
