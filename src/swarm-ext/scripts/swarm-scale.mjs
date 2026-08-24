#!/usr/bin/env node
/**
 * Swarm Scale Script
 * Adjusts max concurrent sub-agents and Redis tuning
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

function getConfig() {
  const path = join(process.cwd(), "xclaw-swarm.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : {};
}

function saveConfig(config) {
  writeFileSync(join(process.cwd(), "xclaw-swarm.json"), JSON.stringify(config, null, 2));
}

function scaleRedis(maxmemory) {
  try {
    execSync(`redis-cli CONFIG SET maxmemory ${maxmemory}`);
    console.log(`[swarm-scale] Redis maxmemory set to ${maxmemory}`);
  } catch (e) {
    console.warn("[swarm-scale] Redis scaling failed:", e.message);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const agentsIdx = args.indexOf("--agents");
  const agents = agentsIdx >= 0 ? parseInt(args[agentsIdx + 1], 10) : null;

  if (!agents) {
    console.error("Usage: node swarm-scale.mjs --agents 100");
    process.exit(1);
  }

  const config = getConfig();
  config.swarm = config.swarm || {};
  config.swarm.orchestrator = config.swarm.orchestrator || {};
  config.swarm.subAgent = config.swarm.subAgent || {};

  config.swarm.orchestrator.maxSubAgents = agents;
  config.swarm.subAgent.maxConcurrent = agents;

  saveConfig(config);
  console.log(`[swarm-scale] maxSubAgents → ${agents}`);
  console.log(`[swarm-scale] maxConcurrent → ${agents}`);

  const redisMemory = Math.max(512, Math.ceil(agents / 10) * 10);
  scaleRedis(`${redisMemory}mb`);

  console.log("[swarm-scale] Done. Restart orchestrator to apply.");
}

main().catch(e => {
  console.error("[swarm-scale] Error:", e.message);
  process.exit(1);
});
