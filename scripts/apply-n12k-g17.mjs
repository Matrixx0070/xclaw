#!/usr/bin/env node
/** Idempotent: land syntheticG17Job + includeG17; also run apply-n12j-g16 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { writeSourceIfChanged } from "./lib/atomic-source-write.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const s of ["apply-n12j-g16.mjs", "apply-n12i-g15.mjs"]) {
  const p = path.join(root, "scripts", s);
  if (fs.existsSync(p)) spawnSync(process.execPath, [p], { cwd: root, encoding: "utf8" });
}

const fp = path.join(root, "src/eval/horizon-offline.mjs");
let t = fs.readFileSync(fp, "utf8");
let n = 0;

if (!t.includes("horizon-g17-metrics")) {
  const anchors = [
    'import { incG16Pass } from "./horizon-g16-metrics.mjs";',
    'import { incG15Pass } from "./horizon-g15-metrics.mjs";',
    'import { incG14Pass } from "./horizon-g14-metrics.mjs";',
  ];
  for (const prev of anchors) {
    if (t.includes(prev)) {
      t = t.replace(
        prev,
        prev + '\nimport { incG17Pass } from "./horizon-g17-metrics.mjs";'
      );
      n++;
      break;
    }
  }
}
if (!t.includes('id.includes("G17")')) {
  for (const g of ["G16", "G15", "G14"]) {
    const needle = `if (id.includes("${g}")) inc${g}Pass();`;
    if (t.includes(needle)) {
      t = t.replace(
        needle,
        needle + '\n      if (id.includes("G17")) incG17Pass();'
      );
      n++;
      break;
    }
  }
}
if (!t.includes("syntheticG17Job")) {
  const block = [
    "",
    "export async function syntheticG17Job(workspace) {",
    "  await fs.mkdir(workspace, { recursive: true });",
    '  await fs.writeFile(path.join(workspace, "final.txt"), "SOAK-DONE\\n");',
    "  await fs.writeFile(",
    '    path.join(workspace, "budget.json"),',
    '    JSON.stringify({ ok: true, usedUsd: 0.25, maxUsd: 1.0 }) + "\\n"',
    "  );",
    "  return {",
    '    text: "Soak complete under budget; wrote final.txt",',
    "    turns: 2,",
    "    toolTrace: [",
    '      { name: "xclaw_file_read", status: "ok" },',
    '      { name: "xclaw_file_write", status: "ok" },',
    "    ],",
    "    toolCalls: 2,",
    "    toolErrors: 0,",
    "    wallMs: 30,",
    '    status: "succeeded",',
    "    workspace,",
    "  };",
    "}",
    "",
  ].join("\n");
  t = t.replace("export default {", block + "export default {");
  for (const s of ["syntheticG16Job,", "syntheticG15Job,", "syntheticG14Job,"]) {
    if (t.includes(s) && !t.includes("syntheticG17Job,")) {
      t = t.replace(s, s + "\n  syntheticG17Job,");
      break;
    }
  }
  n++;
}
if (!t.includes("includeG17")) {
  for (const prev of [
    "const includeG16 = opts.includeG16 === true;",
    "const includeG15 = opts.includeG15 === true;",
    "const includeG14 = opts.includeG14 !== false;",
  ]) {
    if (t.includes(prev)) {
      t = t.replace(
        prev,
        prev + "\n  const includeG17 = opts.includeG17 === true;"
      );
      break;
    }
  }
  n++;
}
if (!t.includes('jobs["a4-G17-overnight-soak"]')) {
  t = t.replace(
    "  return runHorizonOffline({",
    '  if (!jobs["a4-G17-overnight-soak"] && workspace && includeG17) {\n' +
      '    jobs["a4-G17-overnight-soak"] = await syntheticG17Job(\n' +
      '      path.join(workspace, "g17")\n' +
      "    );\n" +
      "  }\n" +
      "  return runHorizonOffline({"
  );
  n++;
}
if (!t.includes('includeG17 ? ["a4-G17-overnight-soak"]')) {
  for (const prev of [
    '...(includeG16 ? ["a4-G16-swarm-ballot-merge"] : []),',
    '...(includeG15 ? ["a4-G15-browser-form-fill"] : []),',
    '...(includeG14 ? ["a4-G14-multi-file-refactor"] : []),',
  ]) {
    if (t.includes(prev)) {
      t = t.replace(
        prev,
        prev + '\n      ...(includeG17 ? ["a4-G17-overnight-soak"] : []),' 
      );
      n++;
      break;
    }
  }
}

writeSourceIfChanged(fp, t);
console.log(JSON.stringify({ ok: true, applied: n }));
