#!/usr/bin/env node
/**
 * Strategy C4 — CI gate for computer engine parity.
 *
 * Fails when:
 * - PARITY_MATRIX.json missing / invalid
 * - defaultPath tools have native status "missing"
 * - maintained module paths in matrix do not exist
 * - registry MAINTAINED_TOOLS names not listed in matrix
 *
 * Does NOT delete or modify xclaw-server.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const matrixPath = path.join(root, "src/computer/PARITY_MATRIX.json");
const registryPath = path.join(root, "src/computer/modules/registry.mjs");

function fail(msg) {
  console.error(`[check:computer-parity] FAIL: ${msg}`);
  process.exit(2);
}

function ok(msg) {
  console.log(`[check:computer-parity] ${msg}`);
}

if (!fs.existsSync(matrixPath)) fail(`missing ${matrixPath}`);

let matrix;
try {
  matrix = JSON.parse(fs.readFileSync(matrixPath, "utf8"));
} catch (e) {
  fail(`invalid JSON in PARITY_MATRIX.json: ${e.message}`);
}

if (!Array.isArray(matrix.tools) || matrix.tools.length === 0) {
  fail("PARITY_MATRIX.tools must be a non-empty array");
}

if (matrix.policy?.handEditBundle === true) {
  fail("policy.handEditBundle must remain false");
}

// D1: product default is bundle; native remains tracked as escape hatch.
const defaultEngine = matrix.policy?.defaultEngine || "bundle";
if (!["bundle", "native", "generated"].includes(String(defaultEngine))) {
  fail(`policy.defaultEngine invalid: ${defaultEngine}`);
}

let errors = 0;

for (const tool of matrix.tools) {
  const name = tool.name || "(unnamed)";
  if (tool.defaultPath && tool.native === "missing") {
    console.error(
      `[check:computer-parity] defaultPath tool ${name} has native=missing`
    );
    errors += 1;
  }
  if (tool.maintainedModule) {
    const p = path.join(root, tool.maintainedModule);
    if (!fs.existsSync(p)) {
      console.error(
        `[check:computer-parity] missing maintainedModule for ${name}: ${tool.maintainedModule}`
      );
      errors += 1;
    } else {
      ok(`module ok: ${name} → ${tool.maintainedModule}`);
    }
  }
}

const parityNames = new Set(matrix.tools.map((t) => t.name));

const regMod = await import(pathToFileURL(registryPath).href);
const maintained = regMod.MAINTAINED_TOOLS || [];
for (const t of maintained) {
  if (!parityNames.has(t.name)) {
    console.error(
      `[check:computer-parity] registry tool ${t.name} missing from PARITY_MATRIX.json`
    );
    errors += 1;
  } else {
    ok(`registry covered: ${t.name}`);
  }
}

const bundlePath = path.join(root, "src/computer/xclaw-server.mjs");
if (!fs.existsSync(bundlePath)) {
  console.error(
    "[check:computer-parity] WARN: legacy bundle missing (fallback unavailable)"
  );
} else {
  ok(`legacy bundle present (${fs.statSync(bundlePath).size} bytes) — retained`);
}

const defaultPath = matrix.tools.filter((t) => t.defaultPath);
const okDefault = defaultPath.filter(
  (t) => t.native === "parity" || t.native === "partial"
);
ok(
  `defaultPath tools: ${okDefault.length}/${defaultPath.length} usable on native (parity|partial)`
);

if (errors) fail(`${errors} parity check error(s)`);

ok("C4 parity gate passed");
process.exit(0);
