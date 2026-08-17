#!/usr/bin/env node
/**
 * P4.4 Eval regression CI — unit packs + optional live eval-ci.
 *
 * Exit nonzero if any unit suite fails.
 * Env:
 *   EVAL_LIVE=1     also run scripts/eval-ci.mjs
 *   EVAL_SKIP_SLOW=1 skip extra-tools network-ish tests
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const UNIT_PACKS = [
  "test/all-local-tools.test.mjs",
  "test/p1-tools.test.mjs",
  "test/p3-tools.test.mjs",
  "test/channels-p2.test.mjs",
  "test/provider-registry.test.mjs",
  "test/computer-contract.test.mjs",
  "test/long-horizon-fixtures.test.mjs",
];

function run(args, opts = {}) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, args, {
      cwd: root,
      env: process.env,
      stdio: "inherit",
      ...opts,
    });
    c.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  console.log("[eval-regression] unit packs");
  for (const pack of UNIT_PACKS) {
    const code = await run(["--test", pack]);
    if (code !== 0) {
      console.error(`[eval-regression] FAIL ${pack}`);
      process.exit(code);
    }
  }
  console.log("[eval-regression] units OK");

  if (process.env.EVAL_LIVE === "1") {
    console.log("[eval-regression] live eval-ci");
    const code = await run([path.join(root, "scripts/eval-ci.mjs")]);
    process.exit(code);
  }
  process.exit(0);
}

main();
