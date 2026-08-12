#!/usr/bin/env node
/**
 * C1 — Computer bundle build stub (Strategy C).
 *
 * Today: validates module inventory + policy; records a build stamp.
 * Does NOT yet fully regenerate xclaw-server.mjs from source (C3).
 *
 * Exit 0 = policy/modules OK.
 * Exit 2 = missing modules or policy violation signal.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const computerDir = path.join(root, "src/computer");
const bundlePath = path.join(computerDir, "xclaw-server.mjs");
const mapPath = path.join(computerDir, "MODULE_MAP.json");
const sotPath = path.join(computerDir, "SOURCE_OF_TRUTH.json");
const stampPath = path.join(computerDir, "build-stamp.json");

const DO_NOT_EDIT = [
  "DO NOT HAND-EDIT",
  "Strategy C",
  "build-computer-bundle",
];

function fail(msg) {
  console.error(`[build:computer] FAIL: ${msg}`);
  process.exit(2);
}

function ok(msg) {
  console.log(`[build:computer] ${msg}`);
}

// --- MODULE_MAP ---
if (!fs.existsSync(mapPath)) fail(`missing ${mapPath}`);
const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
const extracted = Array.isArray(map.extracted) ? map.extracted : [];
if (!extracted.length) fail("MODULE_MAP.extracted is empty");

let missing = 0;
for (const e of extracted) {
  const p = path.join(root, e.path);
  if (!fs.existsSync(p)) {
    console.error(`[build:computer] missing module: ${e.path}`);
    missing += 1;
  } else {
    ok(`module ok: ${e.id} (${e.path})`);
  }
}
if (missing) fail(`${missing} module file(s) missing`);

// Maintained (non-extracted) siblings when present
const maintained = [
  "modules/bash-tool.mjs",
  "modules/file-tools.mjs",
  "modules/browser-tab-tool.mjs",
  "thin-server.mjs",
  "chrome-args.mjs",
  "hooks-bridge.mjs",
  "motor-bridge.mjs",
];
for (const rel of maintained) {
  const p = path.join(computerDir, rel);
  if (fs.existsSync(p)) ok(`source ok: ${rel}`);
  else console.warn(`[build:computer] optional source missing: ${rel}`);
}

// --- Bundle artifact ---
if (!fs.existsSync(bundlePath)) {
  fail(`runtime bundle missing: ${bundlePath} (required artifact; do not delete)`);
}
const st = fs.statSync(bundlePath);
ok(`runtime bundle present: xclaw-server.mjs (${st.size} bytes)`);

// --- SOURCE_OF_TRUTH strategy field ---
let sot = {};
if (fs.existsSync(sotPath)) {
  sot = JSON.parse(fs.readFileSync(sotPath, "utf8"));
}
if (sot.strategy !== "C" && sot.verdict !== "bundle_is_runtime_clean_module_is_edit_source") {
  console.warn(
    "[build:computer] WARN: SOURCE_OF_TRUTH should set strategy=C (updating recommended)"
  );
}

// C1 does not rewrite the 16MB file — stamp only
const stamp = {
  strategy: "C",
  phase: "C1",
  builtAt: new Date().toISOString(),
  fullRebuild: false,
  note:
    "C1 validates modules + keeps xclaw-server.mjs as runtime artifact. Full regenerate lands in C3.",
  bundleBytes: st.size,
  modulesChecked: extracted.map((e) => e.id),
  policy: {
    handEditBundle: false,
    editSource: "src/computer/modules/** and bridges",
  },
};

fs.writeFileSync(stampPath, JSON.stringify(stamp, null, 2) + "\n");
ok(`wrote ${path.relative(root, stampPath)}`);
ok("C1 complete — modules OK; bundle retained as runtime (not hand-edited by this script)");
console.log(
  "\nNext (C3): implement esbuild entry that emits xclaw-server.mjs from modules.\n"
);
process.exit(0);
