/**
 * Health Check — Swarm system diagnostics
 */
import { getConfig } from "./config.mjs";

export async function getSwarmHealth() {
  const cfg = getConfig().swarm;
  const checks = {
    queue: false,
    orchestrator: true,
    plugins: false,
  };

  try {
    const { getTaskQueue } = await import("./task-queue.mjs");
    const queue = await getTaskQueue();
    checks.queue = (await queue.ping()) === "PONG";
  } catch {
    checks.queue = false;
  }

  try {
    const { readdirSync } = await import("fs");
    const { PluginLoader } = await import("./plugin-loader.mjs");
    const loader = new PluginLoader();
    const plugins = loader.discover();
    checks.plugins = plugins.length > 0;
  } catch {
    checks.plugins = false;
  }

  const allHealthy = Object.values(checks).every(Boolean);

  return {
    status: allHealthy ? "healthy" : "degraded",
    checks,
    config: {
      maxSubAgents: cfg.orchestrator.maxSubAgents,
      maxConcurrent: cfg.subAgent.maxConcurrent,
      sandboxType: cfg.subAgent.sandbox.type,
    },
    timestamp: new Date().toISOString(),
  };
}
