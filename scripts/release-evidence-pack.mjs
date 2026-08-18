#!/usr/bin/env node
/**
 * Release evidence pack — pin ship-pack / doctor / eval artifacts under reports/release/.
 *
 * Usage:
 *   node scripts/release-evidence-pack.mjs
 *   node scripts/release-evidence-pack.mjs --run-ship-pack
 *
 * Writes:
 *   reports/release/<stamp>/manifest.json
 *   reports/release/<stamp>/last-doctor.json (copy if present)
 *   reports/release/<stamp>/last-mock.json (copy if present)
 *   reports/release/latest.json (pointer)
 *
 * Exit 0 always when pack succeeds; --require-artifacts fails if baselines missing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runShip = process.argv.includes("--run-ship-pack");
const requireArtifacts = process.argv.includes("--require-artifacts");

function log(m) {
  console.error(`[release-evidence] ${m}`);
}

function gitSha() {
  const r = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  return (r.stdout || "").trim() || null;
}

function readJsonSafe(fp) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

if (runShip) {
  log("running ship-pack");
  const r = spawnSync(process.execPath, ["scripts/ci-ship-pack.mjs"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) {
    log(`ship-pack failed exit=${r.status}`);
    process.exit(r.status ?? 1);
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(root, "reports", "release", stamp);
fs.mkdirSync(outDir, { recursive: true });

const baselines = path.join(root, "eval", "baselines");
const doctorSrc = path.join(baselines, "last-doctor.json");
const mockSrc = path.join(baselines, "last-mock.json");
const doctor = readJsonSafe(doctorSrc);
const mock = readJsonSafe(mockSrc);

if (requireArtifacts && (!doctor || !mock)) {
  log("REQUIRE artifacts: missing last-doctor.json and/or last-mock.json");
  log(`  doctor=${Boolean(doctor)} mock=${Boolean(mock)}`);
  process.exit(1);
}

const pkg = readJsonSafe(path.join(root, "package.json")) || {};

if (doctor) {
  fs.copyFileSync(doctorSrc, path.join(outDir, "last-doctor.json"));
}
if (mock) {
  fs.copyFileSync(mockSrc, path.join(outDir, "last-mock.json"));
}

const manifest = {
  kind: "xclaw_release_evidence",
  schemaVersion: 1,
  version: pkg.version || null,
  stamp,
  at: new Date().toISOString(),
  gitSha: gitSha(),
  shipPackRun: runShip,
  artifacts: {
    doctor: Boolean(doctor),
    mock: Boolean(mock),
    doctorChecks: Array.isArray(doctor?.checks)
      ? doctor.checks.length
      : doctor?.groups
        ? Object.values(doctor.groups).flat().length
        : null,
    doctorOk: doctor?.ok ?? null,
    mockPassRate: mock?.passRate ?? mock?.aggregate?.passRate ?? null,
  },
  paths: {
    dir: path.relative(root, outDir),
    doctor: doctor ? "last-doctor.json" : null,
    mock: mock ? "last-mock.json" : null,
  },
};

fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
const latestDir = path.join(root, "reports", "release");
fs.mkdirSync(latestDir, { recursive: true });
fs.writeFileSync(path.join(latestDir, "latest.json"), JSON.stringify(manifest, null, 2));
log(`wrote ${path.relative(root, outDir)}/manifest.json`);
log(`gitSha=${manifest.gitSha} doctor=${manifest.artifacts.doctor} mock=${manifest.artifacts.mock}`);
console.log(JSON.stringify(manifest, null, 2));
process.exit(0);
