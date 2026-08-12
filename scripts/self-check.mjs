#!/usr/bin/env node
/**
 * Robust self-check: unit tests + doctor + mock eval.
 * Exit 0 only if all pass (doctor warnings allowed if --allow-warn).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const allowWarn = process.argv.includes("--allow-warn");

function run(cmd, args) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { cwd: root, stdio: "inherit", env: process.env });
    c.on("exit", (code) => resolve(code ?? 1));
  });
}

let failed = 0;
console.log("=== npm test ===");
failed += (await run(process.execPath, ["--test", "test/**/*.test.mjs"])) ? 1 : 0;

console.log("\n=== doctor ===");
const docCode = await run(process.execPath, ["bin/xclaw.mjs", "doctor"]);
if (docCode === 2 || (docCode === 1 && !allowWarn)) failed += 1;
else if (docCode === 1) console.log("(warnings allowed)");

console.log("\n=== eval --mock ===");
failed += (await run(process.execPath, ["bin/xclaw.mjs", "eval", "--mock"])) ? 1 : 0;

console.log(failed ? `\nSELF-CHECK FAILED (${failed})` : "\nSELF-CHECK OK");
process.exit(failed ? 1 : 0);
