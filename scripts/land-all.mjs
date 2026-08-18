#!/usr/bin/env node
/**
 * Apply all production wires (land-batch3/4/5) in one shot.
 * Prefer patches/land-all-wires.patch; fall back to sequential batches.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const mega = path.join(root, "patches/land-all-wires.patch");

function run(args) {
  return spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", stdio: "inherit" });
}

if (check) {
  for (const b of ["land-batch3.mjs", "land-batch4.mjs", "land-batch5.mjs"]) {
    const r = run([path.join(root, "scripts", b), "--check"]);
    if ((r.status ?? 1) !== 0) process.exit(r.status || 1);
  }
  console.error("[land-all] check OK");
  process.exit(0);
}

if (fs.existsSync(mega)) {
  const chk = spawnSync("git", ["apply", "--check", mega], { cwd: root, encoding: "utf8" });
  if (chk.status === 0) {
    const a = spawnSync("git", ["apply", "--whitespace=nowarn", mega], { cwd: root, encoding: "utf8" });
    if (a.status === 0) {
      console.error("[land-all] APPLIED patches/land-all-wires.patch");
    } else {
      console.error("[land-all] mega apply failed, falling back to batches");
    }
  } else {
    console.error("[land-all] mega already applied or conflict; falling back to batches");
  }
}

for (const b of ["land-batch3.mjs", "land-batch4.mjs", "land-batch5.mjs"]) {
  const r = run([path.join(root, "scripts", b)]);
  if ((r.status ?? 1) !== 0) {
    console.error(`[land-all] ${b} failed`);
    process.exit(r.status || 1);
  }
}
console.error("[land-all] apply OK");
process.exit(0);
