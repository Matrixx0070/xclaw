#!/usr/bin/env node
/**
 * Start gateway in background and wait until ready.
 * Usage: node scripts/dev-up.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "xclaw.mjs");
const logPath = process.env.XCLAW_GATEWAY_LOG || path.join(root, ".xclaw-gateway.log");
const timeoutMs = Number(process.env.EVAL_WAIT_MS || 60000);

const log = fs.openSync(logPath, "a");
const child = spawn(process.execPath, [bin, "gateway"], {
  cwd: root,
  env: process.env,
  detached: true,
  stdio: ["ignore", log, log],
});
child.unref();
console.error(`[dev-up] gateway pid ${child.pid} log ${logPath}`);

const w = spawn(
  process.execPath,
  [bin, "wait-ready", "--timeout", String(timeoutMs), "--interval", "500"],
  { cwd: root, env: process.env, stdio: "inherit" }
);
w.on("exit", (code) => {
  if (code === 0) {
    console.error("[dev-up] ready");
  } else {
    console.error("[dev-up] not ready — check log");
  }
  process.exit(code ?? 1);
});
