#!/usr/bin/env node
/**
 * CI ship pack — offline one-liner for production readiness smoke.
 *
 * Runs:
 *   0) apply ship patches (idempotent)
 *   1) core unit tests (security, gateway proxy, cost, stream, skills)
 *   2) eval offline smoke (+ last-mock.json when available)
 *   3) xclaw doctor --json (must produce a report; may warn without keys)
 *
 * Usage:
 *   node scripts/ci-ship-pack.mjs
 *   node scripts/ci-ship-pack.mjs --strict
 *   npm run ship:pack
 *   npm run ship:pack:strict
 *
 * Exit 0 only if unit+eval pass and doctor yields a parseable report.
 * With --strict / XCLAW_SHIP_STRICT=1, also requires doctor errors=0.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { SHIP_PACK_EXTRA_UNIT_TESTS } from "../src/ci/ship-pack-unit-tests.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "xclaw.mjs");
const strict =
  process.argv.includes("--strict") ||
  process.env.XCLAW_SHIP_STRICT === "1" ||
  process.env.XCLAW_SHIP_STRICT === "true";

const UNIT_TESTS = [
  "test/bind-safety-prod.test.mjs",
  "test/computer-proxy.test.mjs",
  "test/gateway-tls-proxy-wrap.test.mjs",
  "test/create-http-server-cfg.test.mjs",
  "test/gateway-proxy-http-smoke.test.mjs",
  "test/approval-path-latency.test.mjs",
  "test/approval-sla-load.test.mjs",
  "test/cost-governor-rollover.test.mjs",
  "test/cost-governor-day-race.test.mjs",
  "test/stream-max-resume-cycles.test.mjs",
  "test/stream-resume-drop.test.mjs",
  "test/loop-guard-argument-churn.test.mjs",
  "test/workspace-write-outside.test.mjs",
  "test/workspace-isolation-cross-peer.test.mjs",
  "test/stop-all-kill-switch.test.mjs",
  "test/checkpoint-crash-resume.test.mjs",
  "test/skills-integrity-prod.test.mjs",
  "test/provider-livecheck-circuit.test.mjs",
  "test/eval-ci-smoke-offline.test.mjs",
  "test/eval-baseline-mock-artifact.test.mjs",
  "test/retry-after-jitter.test.mjs",
  "test/apply-ship-patches.test.mjs",
  ...SHIP_PACK_EXTRA_UNIT_TESTS,
].filter((f) => fs.existsSync(path.join(root, f)));

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, {
      cwd: root,
      stdio: opts.stdio || "inherit",
      env: { ...process.env, ...(opts.env || {}) },
    });
    let stdout = "";
    let stderr = "";
    if (opts.capture) {
      c.stdout?.on("data", (d) => (stdout += d));
      c.stderr?.on("data", (d) => (stderr += d));
    }
    c.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function log(msg) {
  console.error(`[ship-pack] ${msg}`);
}

log("apply ship patches");
const ap = await run(process.execPath, ["scripts/apply-ship-patches.mjs"]);
if (ap.code !== 0) {
  log("apply-ship-patches FAILED");
  process.exit(ap.code);
}

log(`unit tests (${UNIT_TESTS.length} files)`);
const unit = await run(process.execPath, ["--test", ...UNIT_TESTS]);
if (unit.code !== 0) {
  log("unit tests FAILED");
  process.exit(unit.code);
}

if (fs.existsSync(path.join(root, "scripts/eval-smoke-offline.mjs"))) {
  log("eval-smoke-offline");
  const ev = await run(process.execPath, ["scripts/eval-smoke-offline.mjs"]);
  if (ev.code !== 0) {
    log("eval-smoke-offline FAILED");
    process.exit(ev.code);
  }
}

log("doctor --json");
const doc = await run(
  process.execPath,
  [bin, "doctor", "--json"],
  {
    capture: true,
    stdio: ["ignore", "pipe", "pipe"],
  }
);
let report;
try {
  const raw = (doc.stdout || "").trim();
  report = JSON.parse(raw);
} catch {
  try {
    const raw = (doc.stdout || "").trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    report = start >= 0 && end > start ? JSON.parse(raw.slice(start, end + 1)) : null;
  } catch {
    report = null;
  }
}
const checks = report?.checks || report?.groups
  ? Object.values(report.groups || {}).flat()
  : null;
if (!report || (!Array.isArray(report.checks) && !checks?.length)) {
  log("doctor did not produce a JSON report with checks");
  log(`stdout head: ${(doc.stdout || "").slice(0, 120)}`);
  process.exit(1);
}
const n = Array.isArray(report.checks) ? report.checks.length : checks.length;
log(`doctor checks=${n} ok=${report.ok} exit=${doc.code}`);
const outDir = path.join(root, "eval", "baselines");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "last-doctor.json"),
  JSON.stringify(report, null, 2)
);
log("wrote eval/baselines/last-doctor.json");

if (strict) {
  log("strict: apply-ship-patches --check");
  const chk = await run(process.execPath, ["scripts/apply-ship-patches.mjs", "--check"]);
  if (chk.code !== 0) {
    log("STRICT FAIL: apply-ship-patches --check (unapplied registered patch)");
    process.exit(2);
  }
  log("strict: ship patches applied");
  const errors =
    Number(report.errors) ||
    (Array.isArray(report.checks)
      ? report.checks.filter((c) => c.status === "error").length
      : (checks || []).filter((c) => c.status === "error").length);
  if (errors > 0 || report.ok === false || (doc.code != null && doc.code >= 2)) {
    log(`STRICT FAIL: doctor errors=${errors} ok=${report.ok} exit=${doc.code}`);
    process.exit(2);
  }
  log("strict: doctor clean");
}

log("SHIP PACK OK");
process.exit(0);
