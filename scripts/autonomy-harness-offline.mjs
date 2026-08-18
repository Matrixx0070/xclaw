#!/usr/bin/env node
/**
 * Offline autonomy harness gate (no API key).
 * Usage: node scripts/autonomy-harness-offline.mjs
 * Exit 0 on pass.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const tests = [
  "test/autonomy-harness-offline.test.mjs",
  "test/autonomy-metrics-a4.test.mjs",
  "test/autonomy-policy.test.mjs",
];

const c = spawn(process.execPath, ["--test", ...tests], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
c.on("exit", (code) => process.exit(code ?? 1));
