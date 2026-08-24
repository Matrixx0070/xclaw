#!/usr/bin/env node
/**
 * Swarm Migration Script
 * Handles data migration between swarm versions
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const MIGRATIONS = {
  "0.1.0_to_0.2.0": async () => {
    console.log("[swarm-migrate] Running 0.1.0 → 0.2.0...");
    const configPath = join(process.cwd(), "xclaw-swarm.json");
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config.swarm?.taskQueue?.brokerUrl) {
        config.swarm.taskQueue.backend = "redis";
        writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log("[swarm-migrate] Updated taskQueue.backend field");
      }
    }
  },
};

async function main() {
  const args = process.argv.slice(2);
  const fromIdx = args.indexOf("--from");
  const toIdx = args.indexOf("--to");
  const from = fromIdx >= 0 ? args[fromIdx + 1] : null;
  const to = toIdx >= 0 ? args[toIdx + 1] : null;

  if (!from || !to) {
    console.error("Usage: node swarm-migrate.mjs --from 0.1.0 --to 0.2.0");
    process.exit(1);
  }

  const key = `${from}_to_${to}`;
  if (MIGRATIONS[key]) {
    await MIGRATIONS[key]();
    console.log("[swarm-migrate] Migration complete.");
  } else {
    console.log(`[swarm-migrate] No migration found for ${from} → ${to}`);
  }
}

main().catch(e => {
  console.error("[swarm-migrate] Error:", e.message);
  process.exit(1);
});
