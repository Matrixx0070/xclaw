#!/usr/bin/env node
/**
 * Offline cost-governor gate (no API key).
 * Usage: node scripts/cost-governor-offline.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  "test/cost-governor.test.mjs",
  "test/cost-governor-rollover.test.mjs",
  "test/cost-estimation.test.mjs",
].filter((f) => fs.existsSync(path.join(root, f)));

const c = spawn(process.execPath, ["--test", ...files], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
c.on("exit", (code) => process.exit(code ?? 1));
