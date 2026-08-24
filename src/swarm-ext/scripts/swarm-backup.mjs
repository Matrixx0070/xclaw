#!/usr/bin/env node
/**
 * Swarm Backup Script
 * Backs up Redis data, PARL samples, session memory, and receipts
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const BACKUP_DIR = join(process.cwd(), "backups", `swarm-${Date.now()}`);

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function log(msg) {
  console.log(`[swarm-backup] ${msg}`);
}

async function backupRedis() {
  log("Backing up Redis...");
  try {
    const rdbPath = execSync("redis-cli CONFIG GET dir", { encoding: "utf-8" }).split("\n")[1];
    const rdbFile = join(rdbPath.trim(), "dump.rdb");
    if (existsSync(rdbFile)) {
      execSync(`cp "${rdbFile}" "${join(BACKUP_DIR, "redis-dump.rdb")}"`);
      log("Redis RDB backed up.");
    } else {
      log("Redis RDB not found, trying BGSAVE...");
      execSync("redis-cli BGSAVE");
      await new Promise(r => setTimeout(r, 2000));
      execSync(`cp "${rdbFile}" "${join(BACKUP_DIR, "redis-dump.rdb")}"`);
      log("Redis RDB backed up after BGSAVE.");
    }
  } catch (e) {
    log(`Redis backup failed: ${e.message}`);
  }
}

async function backupParlSamples() {
  log("Backing up PARL samples...");
  const parlPath = join(process.cwd(), "data", "parl-samples.jsonl");
  if (existsSync(parlPath)) {
    execSync(`cp "${parlPath}" "${join(BACKUP_DIR, "parl-samples.jsonl")}"`);
    log("PARL samples backed up.");
  } else {
    log("No PARL samples found.");
  }
}

async function backupConfig() {
  log("Backing up configuration...");
  const configPath = join(process.cwd(), "xclaw-swarm.json");
  if (existsSync(configPath)) {
    execSync(`cp "${configPath}" "${join(BACKUP_DIR, "xclaw-swarm.json")}"`);
    log("Config backed up.");
  }
}

async function main() {
  console.log("=== XClaw Swarm Backup ===");
  ensureDir(BACKUP_DIR);
  log(`Backup directory: ${BACKUP_DIR}`);

  await backupRedis();
  await backupParlSamples();
  await backupConfig();

  // Create manifest
  const manifest = {
    backedUpAt: new Date().toISOString(),
    version: "0.1.0",
    files: ["redis-dump.rdb", "parl-samples.jsonl", "xclaw-swarm.json"],
  };
  writeFileSync(join(BACKUP_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));

  log("Backup complete.");
  console.log(`\nRestore with: cp ${BACKUP_DIR}/redis-dump.rdb <redis-dir>/dump.rdb`);
}

main().catch(e => {
  console.error("[swarm-backup] Fatal error:", e.message);
  process.exit(1);
});
