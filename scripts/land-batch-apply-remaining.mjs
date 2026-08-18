#!/usr/bin/env node
/**
 * Apply remaining kill-switch / ship-pack / doctor wires (idempotent).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

const NEEDLES = [
  ["src/gateway/ws-stop-control.mjs", "x-xclaw-token"],
  ["bin/xclaw.mjs", "stopSignMain"],
  ["src/gateway/routes-map.mjs", 'path: "/stop"'],
  ["src/cli/doctor.mjs", "attachStopSummary"],
  ["scripts/ci-ship-pack.mjs", "land-kill-switch-wires"],
  ["src/security/authorize-quota.mjs", "collector: ctx.collector"],
];

const PATCHES = [
  "patches/ws-stop-pass-auth-headers.patch",
  "patches/stop-sign-cli.patch",
  "patches/routes-advertise-stop.patch",
  "patches/doctor-stop-summary-wire.patch",
  "patches/ship-pack-land-ks.patch",
  "patches/authorize-quota-collector.patch",
  "patches/land-batch-apply-remaining.patch",
];

function needlesOk() {
  return NEEDLES.every(([f, n]) => {
    const fp = path.join(root, f);
    return fs.existsSync(fp) && fs.readFileSync(fp, "utf8").includes(n);
  });
}

function needList() {
  return NEEDLES.filter(([f, n]) => {
    const fp = path.join(root, f);
    return !(fs.existsSync(fp) && fs.readFileSync(fp, "utf8").includes(n));
  }).map(([f, n]) => `${f}::${n}`);
}

if (check) {
  if (needlesOk()) {
    console.error("[land-batch-remaining] check OK");
    process.exit(0);
  }
  console.error("[land-batch-remaining] NEED", needList().join(", "));
  process.exit(1);
}

if (needlesOk()) {
  console.error("[land-batch-remaining] already applied");
  process.exit(0);
}

for (const rel of PATCHES) {
  const fp = path.join(root, rel);
  if (!fs.existsSync(fp)) continue;
  const chk = spawnSync("git", ["apply", "--check", fp], { cwd: root, encoding: "utf8" });
  if (chk.status !== 0) continue;
  const a = spawnSync("git", ["apply", "--whitespace=nowarn", fp], {
    cwd: root,
    encoding: "utf8",
  });
  if (a.status === 0) console.error(`[land-batch-remaining] APPLIED ${rel}`);
}

if (!needlesOk()) {
  console.error("[land-batch-remaining] still NEED", needList().join(", "));
  process.exit(1);
}
console.error("[land-batch-remaining] apply OK");
process.exit(0);
