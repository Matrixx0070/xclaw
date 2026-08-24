#!/usr/bin/env node
/**
 * Swarm Doctor — Health check and diagnostics
 * Exit codes: 0=ok, 1=warnings, 2=errors
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const CHECKS = {
  passed: 0,
  warnings: 0,
  errors: 0,
};

function ok(msg) {
  console.log(`  ✅ ${msg}`);
  CHECKS.passed++;
}

function warn(msg) {
  console.log(`  ⚠️  ${msg}`);
  CHECKS.warnings++;
}

function err(msg) {
  console.log(`  ❌ ${msg}`);
  CHECKS.errors++;
}

async function checkNodeVersion() {
  const version = process.version;
  const major = parseInt(version.slice(1).split(".")[0], 10);
  if (major >= 22) {
    ok(`Node.js ${version}`);
  } else {
    err(`Node.js ${version} — requires >= 22`);
  }
}

async function checkConfig() {
  const configPath = join(process.cwd(), "xclaw-swarm.json");
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      ok("xclaw-swarm.json loaded");
      if (config.swarm?.enabled) {
        ok("Swarm is enabled");
      } else {
        warn("Swarm is disabled in config");
      }
    } catch (e) {
      err(`xclaw-swarm.json invalid: ${e.message}`);
    }
  } else {
    err("xclaw-swarm.json not found");
  }
}

async function checkRedis() {
  try {
    const { execSync } = await import("child_process");
    const ping = execSync("redis-cli ping", { encoding: "utf-8" }).trim();
    if (ping === "PONG") {
      ok("Redis is running");
      const info = execSync("redis-cli INFO server", { encoding: "utf-8" });
      const version = info.match(/redis_version:(.+)/)?.[1]?.trim();
      if (version) ok(`Redis version ${version}`);
    } else {
      err("Redis not responding");
    }
  } catch {
    err("Redis not installed or not running");
  }
}

async function checkEnv() {
  const required = ["XAI_API_KEY", "OPENAI_API_KEY"];
  let hasAny = false;
  for (const key of required) {
    if (process.env[key]) {
      ok(`${key} is set`);
      hasAny = true;
    }
  }
  if (!hasAny) {
    warn("No API keys set (XAI_API_KEY or OPENAI_API_KEY)");
  }
}

async function checkPlugins() {
  const pluginsDir = join(process.cwd(), "plugins");
  if (!existsSync(pluginsDir)) {
    warn("plugins/ directory not found");
    return;
  }
  const { readdirSync } = await import("fs");
  const plugins = readdirSync(pluginsDir, { withFileTypes: true }).filter(d => d.isDirectory());
  ok(`${plugins.length} plugins discovered`);

  for (const plugin of plugins) {
    const manifestPath = join(pluginsDir, plugin.name, "xclaw.plugin.json");
    if (existsSync(manifestPath)) {
      ok(`Plugin '${plugin.name}' has manifest`);
    } else {
      warn(`Plugin '${plugin.name}' missing manifest`);
    }
  }
}

async function checkDocker() {
  try {
    const { execSync } = await import("child_process");
    const version = execSync("docker --version", { encoding: "utf-8" }).trim();
    ok(version);
  } catch {
    warn("Docker not found — sandbox features unavailable");
  }
}

async function main() {
  console.log("=== XClaw Swarm Doctor ===\n");

  console.log("Node.js:");
  await checkNodeVersion();

  console.log("\nConfiguration:");
  await checkConfig();

  console.log("\nRedis:");
  await checkRedis();

  console.log("\nEnvironment:");
  await checkEnv();

  console.log("\nPlugins:");
  await checkPlugins();

  console.log("\nDocker:");
  await checkDocker();

  console.log("\n=== Summary ===");
  console.log(`  Passed:   ${CHECKS.passed}`);
  console.log(`  Warnings: ${CHECKS.warnings}`);
  console.log(`  Errors:   ${CHECKS.errors}`);

  if (CHECKS.errors > 0) {
    console.log("\nExit 2 — errors found.");
    process.exit(2);
  } else if (CHECKS.warnings > 0) {
    console.log("\nExit 1 — warnings found.");
    process.exit(1);
  } else {
    console.log("\nExit 0 — all checks passed.");
    process.exit(0);
  }
}

main().catch(e => {
  console.error("[swarm-doctor] Fatal error:", e.message);
  process.exit(2);
});
