#!/usr/bin/env node
/**
 * Strategy C3 — build computer from modules.
 * Emits generated/computer-server.mjs; does NOT overwrite xclaw-server.mjs (16MB CDP).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const computerDir = path.join(root, "src/computer");
const bundlePath = path.join(computerDir, "xclaw-server.mjs");
const generatedPath = path.join(computerDir, "generated/computer-server.mjs");
const mapPath = path.join(computerDir, "MODULE_MAP.json");
const sotPath = path.join(computerDir, "SOURCE_OF_TRUTH.json");
const stampPath = path.join(computerDir, "build-stamp.json");
const thinEntry = path.join(computerDir, "thin-server.mjs");

function fail(msg) {
  console.error(`[build:computer] FAIL: ${msg}`);
  process.exit(2);
}
function ok(msg) {
  console.log(`[build:computer] ${msg}`);
}

if (!fs.existsSync(mapPath)) fail(`missing ${mapPath}`);
const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
const extracted = Array.isArray(map.extracted) ? map.extracted : [];
const maintained = Array.isArray(map.maintained) ? map.maintained : [];
if (!extracted.length) fail("MODULE_MAP.extracted is empty");

let missing = 0;
for (const e of extracted) {
  const p = path.join(root, e.path);
  if (!fs.existsSync(p)) {
    console.error(`[build:computer] missing extracted ref: ${e.path}`);
    missing += 1;
  } else ok(`extracted ref ok: ${e.id}`);
}
for (const e of maintained) {
  const p = path.join(root, e.path);
  if (!fs.existsSync(p)) {
    console.error(`[build:computer] missing maintained source: ${e.path}`);
    missing += 1;
  } else ok(`maintained ok: ${e.id}`);
}
if (!fs.existsSync(thinEntry)) {
  missing += 1;
  console.error(`[build:computer] missing ${thinEntry}`);
}
if (missing) fail(`${missing} required file(s) missing`);

if (!fs.existsSync(bundlePath)) fail(`CDP runtime missing: ${bundlePath}`);
const legacyBytes = fs.statSync(bundlePath).size;
ok(`legacy CDP runtime present (${legacyBytes} bytes) — will not overwrite`);

fs.mkdirSync(path.dirname(generatedPath), { recursive: true });
const esbuildArgs = [
  thinEntry,
  "--bundle",
  "--platform=node",
  "--format=esm",
  `--outfile=${generatedPath}`,
  "--banner:js=/* Strategy C3 GENERATED — do not hand-edit. Full CDP remains xclaw-server.mjs */",
  "--packages=bundle",
];

let r = spawnSync("npx", ["--yes", "esbuild", ...esbuildArgs], {
  cwd: root,
  encoding: "utf8",
});
if (r.status !== 0) {
  const local = path.join(root, "node_modules/.bin/esbuild");
  if (fs.existsSync(local)) {
    r = spawnSync(local, esbuildArgs, { cwd: root, encoding: "utf8" });
  }
}
if (r.status !== 0) {
  console.error(r.stdout || "");
  console.error(r.stderr || "");
  fail("esbuild failed");
}
if (!fs.existsSync(generatedPath)) fail("generated output missing");
const genBytes = fs.statSync(generatedPath).size;
ok(`generated ${path.relative(root, generatedPath)} (${genBytes} bytes)`);

const stamp = {
  strategy: "C",
  phase: "C3",
  builtAt: new Date().toISOString(),
  // The 16MB legacy CDP bundle is never rebuilt by this script
  fullRebuild: false,
  generatedEmit: true,
  generatedPath: "src/computer/generated/computer-server.mjs",
  generatedBytes: genBytes,
  legacyBundlePath: "src/computer/xclaw-server.mjs",
  legacyBundleBytes: legacyBytes,
  legacyOverwritten: false,
  note: "C3 emits modules-built server to generated/. 16MB CDP xclaw-server.mjs retained.",
  modulesChecked: extracted.map((e) => e.id),
  maintainedChecked: maintained.map((e) => e.id),
  policy: { handEditBundle: false, handEditGenerated: false },
};
fs.writeFileSync(stampPath, JSON.stringify(stamp, null, 2) + "\n");
ok(`wrote ${path.relative(root, stampPath)}`);

try {
  if (fs.existsSync(sotPath)) {
    const sot = JSON.parse(fs.readFileSync(sotPath, "utf8"));
    sot.strategy = "C";
    sot.strategyPhase = "C3";
    sot.generatedEntry = "src/computer/generated/computer-server.mjs";
    fs.writeFileSync(sotPath, JSON.stringify(sot, null, 2) + "\n");
  }
} catch {
  /* */
}

ok("C3 complete");
process.exit(0);
