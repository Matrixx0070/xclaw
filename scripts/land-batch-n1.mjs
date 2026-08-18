#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const NEEDLES = [
  ["src/gateway/stop-route.mjs", "dryRun"],
  ["scripts/ci-ship-pack.mjs", "stop-fire-drill"],
  ["scripts/release-gate.mjs", "stop-fire-drill"],
  ["scripts/ci-ship-pack.mjs", "land-kill-switch-wires"],
];
const PATCHES = [
  "patches/stop-dry-run-route.patch",
  "patches/ship-pack-stop-fire-drill.patch",
  "patches/release-gate-stop-fire-drill.patch",
  "patches/ship-pack-land-ks.patch",
  "patches/land-batch-n1.patch",
];

function needList() {
  return NEEDLES.filter(([f, n]) => {
    const fp = path.join(root, f);
    return !(fs.existsSync(fp) && fs.readFileSync(fp, "utf8").includes(n));
  }).map(([f, n]) => `${f}::${n}`);
}

if (check) {
  if (!needList().length) {
    console.error("[land-n1] check OK");
    process.exit(0);
  }
  console.error("[land-n1] NEED", needList().join(", "));
  process.exit(1);
}
if (!needList().length) {
  console.error("[land-n1] already applied");
  process.exit(0);
}
for (const rel of PATCHES) {
  const fp = path.join(root, rel);
  if (!fs.existsSync(fp)) continue;
  if (spawnSync("git", ["apply", "--check", fp], { cwd: root }).status !== 0) continue;
  if (spawnSync("git", ["apply", "--whitespace=nowarn", fp], { cwd: root }).status === 0) {
    console.error(`[land-n1] APPLIED ${rel}`);
  }
}
if (needList().length) {
  console.error("[land-n1] still NEED", needList().join(", "));
  process.exit(1);
}
console.error("[land-n1] apply OK");
process.exit(0);
