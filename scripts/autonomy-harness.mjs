#!/usr/bin/env node
/**
 * Autonomy harness dispatcher.
 *   --offline (default): unit/metrics gate, no API key
 *   --live: requires XAI_API_KEY, runs a4-* via agent
 *
 * Usage:
 *   node scripts/autonomy-harness.mjs
 *   node scripts/autonomy-harness.mjs --live
 *   node scripts/autonomy-harness.mjs --live --id a4-G01-write-read
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const live = process.argv.includes("--live");
const script = live
  ? path.join(root, "scripts/autonomy-harness-live.mjs")
  : path.join(root, "scripts/autonomy-harness-offline.mjs");

const extra = process.argv.filter(
  (a, i) => i > 1 && a !== "--live" && a !== "--offline"
);

const c = spawn(process.execPath, [script, ...extra], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
c.on("exit", (code) => process.exit(code ?? 1));
