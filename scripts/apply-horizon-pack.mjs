#!/usr/bin/env node
/** Land full offline horizon pack (G15–G20) + includeAll support. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chain = [
  "apply-n12i-g15.mjs",
  "apply-n12j-g16.mjs",
  "apply-n12k-g17.mjs",
  "apply-n12l-g18.mjs",
  "apply-n12m-g19.mjs",
  "apply-n12n-g20.mjs",
];

const results = [];
for (const s of chain) {
  const p = path.join(root, "scripts", s);
  if (!fs.existsSync(p)) {
    results.push({ script: s, ok: false, reason: "missing" });
    continue;
  }
  const r = spawnSync(process.execPath, [p], { cwd: root, encoding: "utf8" });
  results.push({ script: s, ok: r.status === 0, status: r.status });
  if (r.status !== 0) {
    console.error(JSON.stringify({ ok: false, results }, null, 2));
    process.exit(r.status || 1);
  }
}

const fp = path.join(root, "src/eval/horizon-offline.mjs");
let t = fs.readFileSync(fp, "utf8");
if (!t.includes("__horizonIncludeAll")) {
  const marker = "export async function runHorizonSuiteOffline(opts = {}) {";
  const inject = `export async function runHorizonSuiteOffline(opts = {}) {
  // __horizonIncludeAll
  if (opts.includeAll === true || opts.all === true) {
    opts = {
      ...opts,
      includeG12: true,
      includeG14: true,
      includeG15: true,
      includeG16: true,
      includeG17: true,
      includeG18: true,
      includeG19: true,
      includeG20: true,
    };
  }`;
  if (t.includes(marker)) {
    t = t.replace(marker, inject);
  }
}

// Ensure G15/G16 suite wires (idempotent)
let ho = t;
if (!ho.includes('jobs["a4-G15-browser-form-fill"]')) {
  const needle =
    '  if (!jobs["a4-G14-multi-file-refactor"] && workspace && includeG14) {\n' +
    '    jobs["a4-G14-multi-file-refactor"] = await syntheticG14Job(\n' +
    '      path.join(workspace, "g14")\n' +
    "    );\n" +
    "  }";
  const add =
    needle +
    '\n  if (!jobs["a4-G15-browser-form-fill"] && workspace && includeG15) {\n' +
    '    jobs["a4-G15-browser-form-fill"] = await syntheticG15Job(\n' +
    '      path.join(workspace, "g15")\n' +
    "    );\n" +
    "  }\n" +
    '  if (!jobs["a4-G16-swarm-ballot-merge"] && workspace && includeG16) {\n' +
    '    jobs["a4-G16-swarm-ballot-merge"] = await syntheticG16Job(\n' +
    '      path.join(workspace, "g16")\n' +
    "    );\n" +
    "  }";
  if (ho.includes(needle)) ho = ho.replace(needle, add);
}
if (!ho.includes('includeG15 ? ["a4-G15-browser-form-fill"]')) {
  ho = ho.replace(
    '...(includeG14 ? ["a4-G14-multi-file-refactor"] : []),',
    '...(includeG14 ? ["a4-G14-multi-file-refactor"] : []),\n' +
      '      ...(includeG15 ? ["a4-G15-browser-form-fill"] : []),\n' +
      '      ...(includeG16 ? ["a4-G16-swarm-ballot-merge"] : []),' 
  );
}
fs.writeFileSync(fp, ho);
console.log(JSON.stringify({ ok: true, applied: results.length, results }, null, 2));
