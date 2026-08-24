/**
 * Configuration Management
 * Loads xclaw-swarm.json with env var resolution and deep merge
 */
import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { homedir } from "os";

const DEFAULTS = {
  swarm: {
    enabled: true,
    orchestrator: {
      model: "xai/grok-4.5",
      fallbackModel: "openai/gpt-4o",
      maxSubAgents: 300,
      maxToolCalls: 4000,
      maxSteps: 15,
      timeoutSeconds: 1200,
      temperature: 0.2,
      topP: 0.95,
      planningMode: "strict",
      autoRetry: true,
      retryAttempts: 3,
    },
    subAgent: {
      model: "xai/grok-4.5",
      fallbackModel: "openai/gpt-4o-mini",
      maxConcurrent: 300,
      timeoutSeconds: 300,
      temperature: 0.3,
      retryAttempts: 3,
      sandbox: {
        enabled: true,
        type: "docker",
        image: "xclaw-swarm-subagent:latest",
        memoryLimit: "512m",
        cpuLimit: 1.0,
        networkMode: "bridge",
        readOnlyRoot: true,
        tmpfsSize: "100m",
      },
    },
    taskQueue: {
      backend: "redis",
      brokerUrl: "redis://localhost:6379/0",
      resultBackend: "redis://localhost:6379/1",
      taskSerializer: "json",
      acceptContent: ["json"],
      resultExpires: 3600,
      maxRetries: 3,
      retryDelay: 5000,
    },
    contextSharding: {
      enabled: true,
      shardSize: 16000,
      overlap: 2000,
      vectorStore: "redis",
      embeddingModel: "text-embedding-3-small",
    },
    plugins: {
      directory: "./plugins",
      autoLoad: true,
      builtinTools: [
        "web-search", "web-extract", "web-crawl",
        "code-executor", "browser", "file-reader",
        "calculator", "image-generate", "tts",
      ],
      mcpServers: [],
      mcpEagerTools: [],
    },
    mergePolicy: {
      mode: "llm",
      autoMerge: false,
      requireApproval: true,
      confidenceThreshold: 0.85,
      fallbackMode: "concat",
    },
    receipt: {
      enabled: true,
      includeToolCalls: true,
      includeTokenUsage: true,
      includeDiffs: true,
      maxHistoryLength: 1000,
    },
    parl: {
      enabled: true,
      rewardModel: "heuristic",
      trainingInterval: 100,
      minSamplesForTraining: 10,
      exportPath: "./data/parl-samples.jsonl",
    },
    heartbeat: {
      enabled: true,
      intervalSeconds: 30,
      maxConsecutiveFailures: 10,
      backoffStrategy: "exponential",
    },
    watchdog: {
      enabled: true,
      taskTimeoutSeconds: 1800,
      agentTimeoutSeconds: 600,
      cleanupIntervalSeconds: 60,
    },
    budget: {
      enabled: false,
      maxTokensPerTask: 1000000,
      maxCostPerTask: 10.0,
      currency: "USD",
      alertThreshold: 0.8,
    },
    telemetry: {
      enabled: true,
      prometheusPort: 9090,
      metrics: [
        "task_count", "sub_agent_count", "tool_call_count",
        "latency_seconds", "error_rate", "token_usage", "parallel_ratio",
      ],
    },
  },
};

function deepMerge(base, override) {
  if (!override || typeof override !== "object") return override;
  const result = { ...base };
  for (const key in override) {
    if (override[key] && typeof override[key] === "object" && !Array.isArray(override[key])) {
      result[key] = deepMerge(base[key] || {}, override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

function resolveEnv(value) {
  if (typeof value !== "string") return value;
  const match = value.match(/^\$\{(.+)\}$/);
  if (match) {
    const envVal = process.env[match[1]];
    if (envVal === undefined) {
      console.warn(`[swarm-config] Env var ${match[1]} not set, using default`);
      return value;
    }
    // Try JSON parse for numbers/booleans/arrays
    try {
      return JSON.parse(envVal);
    } catch {
      return envVal;
    }
  }
  return value;
}

function resolveAllEnv(obj) {
  if (typeof obj === "string") return resolveEnv(obj);
  if (Array.isArray(obj)) return obj.map(resolveAllEnv);
  if (obj && typeof obj === "object") {
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = resolveAllEnv(v);
    }
    return result;
  }
  return obj;
}

export function loadConfig(configPath = null) {
  const paths = [
    configPath,
    process.env.XCLAW_SWARM_CONFIG,
    join(process.cwd(), "xclaw-swarm.json"),
    join(process.cwd(), "config", "xclaw-swarm.json"),
    join(homedir(), ".xclaw", "xclaw-swarm.json"),
    join(homedir(), ".config", "xclaw", "xclaw-swarm.json"),
  ].filter(Boolean);

  let fileConfig = {};
  for (const p of paths) {
    try {
      const resolved = resolve(p);
      if (!existsSync(resolved)) continue;
      const text = readFileSync(resolved, "utf-8");
      fileConfig = JSON.parse(text);
      console.log(`[swarm-config] Loaded config from ${resolved}`);
      break;
    } catch (e) {
      continue;
    }
  }

  const merged = deepMerge(DEFAULTS, fileConfig);
  return resolveAllEnv(merged);
}

let _config = null;

export function getConfig() {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

export function setConfig(config) {
  _config = config;
}

export function reloadConfig() {
  _config = loadConfig();
  return _config;
}

export function getSwarmConfig() {
  return getConfig().swarm;
}
