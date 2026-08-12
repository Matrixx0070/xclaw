#!/usr/bin/env node
/**
 * Thin PATH entry for npm bin / global install.
 * Handles init/onboard here; delegates all other commands to bin/xclaw.mjs.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const cmd = args[0] || "help";

if (cmd === "init" || cmd === "onboard") {
  const { initMain } = await import("../src/cli/init.mjs");
  const code = await initMain(args.slice(1));
  process.exit(code ?? 0);
}

const legacy = path.join(__dirname, "xclaw.mjs");
const child = spawn(process.execPath, [legacy, ...args], {
  stdio: "inherit",
  env: process.env,
  cwd: process.cwd(),
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
