#!/usr/bin/env node
/**
 * Apply durable ship patches (doctor integrity, createHttpServer cfg, cost lock, …).
 * Idempotent via content markers; --check exits 1 if any unapplied.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patchesDir = path.join(root, "patches");
const checkOnly = process.argv.includes("--check");
const force = process.argv.includes("--force");

const SHIP_PATCHES = [
  {
    file: "doctor-skills-integrity.patch",
    isApplied: (rootDir) => {
      const t = read(rootDir, "src/cli/doctor.mjs");
      return t.includes("pushSkillsIntegrity");
    },
  },
  {
    file: "create-http-server-cfg.patch",
    isApplied: (rootDir) => {
      const t = read(rootDir, "src/gateway/index.mjs");
      return t.includes("}, cfg);") && t.includes("server.listen(cfg.gateway.port");
    },
  },
  {
    file: "doctor-voice-capture.patch",
    isApplied: (rootDir) => {
      const t = read(rootDir, "src/cli/doctor.mjs");
      return /doctor-voice|pushVoiceWakeAndCapture|voice\.capture/.test(t);
    },
  },
  {
    file: "skill-integrity-prod-runtime.patch",
    isApplied: (rootDir) => {
      const text = read(rootDir, "src/skills/integrity.mjs");
      return text.includes("no_lockfile") && text.includes("excluding all skills");
    },
  },
  {
    file: "cost-governor-atomic.patch",
    isApplied: (rootDir) => {
      const text = read(rootDir, "src/tokens/cost-governor.mjs");
      return text.includes("withLedgerLock") && text.includes("recordJobCostUnlocked");
    },
  },
  {
    file: "single-port-gateway-index.patch",
    isApplied: (rootDir) => {
      const t = read(rootDir, "src/gateway/index.mjs");
      const tls = read(rootDir, "src/gateway/tls.mjs");
      return t.includes("proxyComputerRequest") || tls.includes("wrapWithComputerProxy");
    },
  },
  {
    file: "job-claims-gate-wire.patch",
    isApplied: (rootDir) => {
      const t = read(rootDir, "src/jobs/job.mjs");
      return t.includes("gateStructuredClaims") && t.includes("claims_soft_retry");
    },
  },
  {
    file: "goal-receipt-hash.patch",
    isApplied: (rootDir) => {
      const t = read(rootDir, "src/agent/goal-loop.mjs");
      return t.includes("toolHashTip") && t.includes("buildToolHashChain");
    },
  },
  {
    file: "authorize-quota.patch",
    isApplied: (rootDir) => {
      const t = read(rootDir, "src/security/approvals.mjs");
      return t.includes("authorizeQuotaPreflight");
    },
  },
  {
    file: "ws-redact-emit.patch",
    isApplied: (rootDir) => {
      const t = read(rootDir, "src/gateway/ws-hub.mjs");
      return t.includes("redactEvent") && t.includes("redact-secrets");
    },
  },
  {
    file: "sse-redact.patch",
    isApplied: (rootDir) => {
      const t = read(rootDir, "src/gateway/sse.mjs");
      return t.includes("redactEvent") && t.includes("redact-secrets");
    },
  },
  {
    file: "doctor-perf-wire.patch",
    isApplied: (rootDir) => {
      const t = read(rootDir, "src/cli/doctor.mjs");
      return t.includes("pushPerfChecks");
    },
  },
];

function read(rootDir, rel) {
  const fp = path.join(rootDir, rel);
  if (!fs.existsSync(fp)) return "";
  return fs.readFileSync(fp, "utf8");
}

function log(m) {
  console.error(`[apply-patches] ${m}`);
}

function applyOne(entry) {
  const patchPath = path.join(patchesDir, entry.file);
  if (!fs.existsSync(patchPath)) {
    log(`SKIP missing ${entry.file}`);
    return "missing";
  }
  const already = entry.isApplied(root);
  if (already && !force) {
    log(`OK already applied: ${entry.file}`);
    return "already";
  }
  if (checkOnly) {
    log(`NEED ${entry.file}`);
    return "need";
  }
  const r = spawnSync("git", ["apply", "--whitespace=nowarn", patchPath], {
    cwd: root,
    encoding: "utf8",
  });
  if (r.status === 0) {
    log(`APPLIED ${entry.file}`);
    return "applied";
  }
  if (entry.isApplied(root)) {
    log(`OK applied (marker present after non-zero git apply): ${entry.file}`);
    return "already";
  }
  log(`FAIL ${entry.file}: ${(r.stderr || r.stdout || "").slice(0, 240)}`);
  return "fail";
}

if (!fs.existsSync(patchesDir)) {
  log("no patches/ directory — nothing to do");
  process.exit(0);
}

const results = SHIP_PATCHES.map(applyOne);
if (checkOnly) {
  process.exit(results.includes("need") ? 1 : 0);
}
if (results.includes("fail")) {
  process.exit(1);
}
log("done");
process.exit(0);
