#!/usr/bin/env node
/**
 * Full kill-switch surface lander (idempotent).
 * Covers health/WS/loop + doctor/ship/CLI + dry-run + fire-drill CI.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

const NEEDLES = [
  ["src/gateway/routes/ops.mjs", "stopAuthReadiness"],
  ["src/gateway/ws-hub.mjs", "handleWsStopControl"],
  ["src/agent/loop.mjs", "guardToolAgainstHardCircuit"],
  ["src/gateway/ws-stop-control.mjs", "x-xclaw-token"],
  ["bin/xclaw.mjs", "stopSignMain"],
  ["src/gateway/routes-map.mjs", 'path: "/stop"'],
  ["src/cli/doctor.mjs", "attachStopSummary"],
  ["scripts/ci-ship-pack.mjs", "land-kill-switch-wires"],
  ["src/security/authorize-quota.mjs", "collector: ctx.collector"],
  ["src/gateway/stop-route.mjs", "dryRun"],
  ["scripts/ci-ship-pack.mjs", "stop-fire-drill"],
  ["scripts/release-gate.mjs", "stop-fire-drill"],
];

const PATCHES = [
  "patches/ops-health-stop.patch",
  "patches/ws-hub-stop-control.patch",
  "patches/quota-hard-circuit-loop.patch",
  "patches/ws-hub-pass-cfg.patch",
  "patches/land-kill-switch-wires.patch",
  "patches/ws-stop-pass-auth-headers.patch",
  "patches/stop-sign-cli.patch",
  "patches/routes-advertise-stop.patch",
  "patches/doctor-stop-summary-wire.patch",
  "patches/ship-pack-land-ks.patch",
  "patches/authorize-quota-collector.patch",
  "patches/land-batch-apply-remaining.patch",
  "patches/stop-dry-run-route.patch",
  "patches/ship-pack-stop-fire-drill.patch",
  "patches/release-gate-stop-fire-drill.patch",
  "patches/land-batch-n1.patch",
];

function needList() {
  return NEEDLES.filter(([f, n]) => {
    const fp = path.join(root, f);
    return !(fs.existsSync(fp) && fs.readFileSync(fp, "utf8").includes(n));
  }).map(([f, n]) => `${f}::${n}`);
}

function needlesOk() {
  return needList().length === 0;
}

if (check) {
  if (needlesOk()) {
    console.error("[land-ks] check OK");
    process.exit(0);
  }
  console.error("[land-ks] NEED", needList().join(", "));
  process.exit(1);
}

if (needlesOk()) {
  console.error("[land-ks] already applied");
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
  if (a.status === 0) console.error(`[land-ks] APPLIED ${rel}`);
}

if (!needlesOk()) {
  console.error("[land-ks] still NEED", needList().join(", "));
  process.exit(1);
}
console.error("[land-ks] apply OK");
process.exit(0);
