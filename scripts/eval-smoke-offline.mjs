#!/usr/bin/env node
/**
 * Offline eval smoke gate (no API key).
 * 1) unit tests for smoke case load + mock suite
 * 2) xclaw eval --mock --tag smoke (exit 0)
 *
 * Usage: node scripts/eval-smoke-offline.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "xclaw.mjs");

function run(cmd, args) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { cwd: root, stdio: "inherit", env: process.env });
    c.on("exit", (code) => resolve(code ?? 1));
  });
}

const t = await run(process.execPath, ["--test", "test/eval-ci-smoke-offline.test.mjs"]);
if (t !== 0) process.exit(t);

const m = await run(process.execPath, [bin, "eval", "--mock", "--tag", "smoke", "--json"]);
process.exit(m === 0 ? 0 : m);
