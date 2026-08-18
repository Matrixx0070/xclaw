#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const patches = [
  "patches/ops-health-stop.patch",
  "patches/ws-hub-stop-control.patch",
  "patches/quota-hard-circuit-loop.patch",
  "patches/land-remaining-wires.patch",
];

function appliedNeedles() {
  const needles = [
    ["src/gateway/routes/ops.mjs", "stopAuthReadiness"],
    ["src/gateway/ws-hub.mjs", "handleWsStopControl"],
    ["src/agent/loop.mjs", "guardToolAgainstHardCircuit"],
  ];
  return needles.every(([f, n]) => {
    const fp = path.join(root, f);
    return fs.existsSync(fp) && fs.readFileSync(fp, "utf8").includes(n);
  });
}

if (check) {
  if (appliedNeedles()) {
    console.error("[land-remaining] check OK");
    process.exit(0);
  }
  console.error("[land-remaining] NEED wires");
  process.exit(1);
}

if (appliedNeedles()) {
  console.error("[land-remaining] already applied");
  process.exit(0);
}

for (const rel of patches) {
  const fp = path.join(root, rel);
  if (!fs.existsSync(fp)) continue;
  const chk = spawnSync("git", ["apply", "--check", fp], { cwd: root, encoding: "utf8" });
  if (chk.status !== 0) continue;
  const a = spawnSync("git", ["apply", "--whitespace=nowarn", fp], { cwd: root, encoding: "utf8" });
  if (a.status === 0) console.error(`[land-remaining] APPLIED ${rel}`);
}

if (!appliedNeedles()) {
  console.error("[land-remaining] still NEED after apply");
  process.exit(1);
}
console.error("[land-remaining] apply OK");
process.exit(0);
