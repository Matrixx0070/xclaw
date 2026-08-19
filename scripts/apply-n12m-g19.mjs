#!/usr/bin/env node
/** Idempotent: land syntheticG19Job + includeG19; also run apply-n12l-g18 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const s of [
  "apply-n12l-g18.mjs",
  "apply-n12k-g17.mjs",
  "apply-n12j-g16.mjs",
  "apply-n12i-g15.mjs",
]) {
  const p = path.join(root, "scripts", s);
  if (fs.existsSync(p)) spawnSync(process.execPath, [p], { cwd: root, encoding: "utf8" });
}

const fp = path.join(root, "src/eval/horizon-offline.mjs");
let t = fs.readFileSync(fp, "utf8");
let n = 0;

if (!t.includes("horizon-g19-metrics")) {
  const anchors = [
    'import { incG18Pass } from "./horizon-g18-metrics.mjs";',
    'import { incG17Pass } from "./horizon-g17-metrics.mjs";',
    'import { incG16Pass } from "./horizon-g16-metrics.mjs";',
    'import { incG15Pass } from "./horizon-g15-metrics.mjs";',
    'import { incG14Pass } from "./horizon-g14-metrics.mjs";',
  ];
  for (const prev of anchors) {
    if (t.includes(prev)) {
      t = t.replace(
        prev,
        prev + '\nimport { incG19Pass } from "./horizon-g19-metrics.mjs";'
      );
      n++;
      break;
    }
  }
}
if (!t.includes('id.includes("G19")')) {
  for (const g of ["G18", "G17", "G16", "G15", "G14"]) {
    const needle = `if (id.includes("${g}")) inc${g}Pass();`;
    if (t.includes(needle)) {
      t = t.replace(
        needle,
        needle + '\n      if (id.includes("G19")) incG19Pass();'
      );
      n++;
      break;
    }
  }
}
if (!t.includes("syntheticG19Job")) {
  const block = [
    "",
    "export async function syntheticG19Job(workspace) {",
    "  await fs.mkdir(workspace, { recursive: true });",
    '  await fs.writeFile(path.join(workspace, "grounded.txt"), "CANARY-OK\\n");',
    "  await fs.writeFile(",
    '    path.join(workspace, "canary.json"),',
    '    JSON.stringify({ recovered: true, phase: "soft_recover" }) + "\\n"',
    "  );",
    "  return {",
    '    text: "Canary soft-recover then grounded write",',
    "    turns: 3,",
    "    toolTrace: [",
    '      { name: "xclaw_file_write", status: "ok" },',
    '      { name: "xclaw_file_read", status: "ok" },',
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
  for (const s of [
    "syntheticG18Job,",
    "syntheticG17Job,",
    "syntheticG16Job,",
    "syntheticG15Job,",
    "syntheticG14Job,",
  ]) {
    if (t.includes(s) && !t.includes("syntheticG19Job,")) {
      t = t.replace(s, s + "\n  syntheticG19Job,");
      break;
    }
  }
  n++;
}
if (!t.includes("includeG19")) {
  for (const prev of [
    "const includeG18 = opts.includeG18 === true;",
    "const includeG17 = opts.includeG17 === true;",
    "const includeG16 = opts.includeG16 === true;",
    "const includeG15 = opts.includeG15 === true;",
    "const includeG14 = opts.includeG14 !== false;",
  ]) {
    if (t.includes(prev)) {
      t = t.replace(
        prev,
        prev + "\n  const includeG19 = opts.includeG19 === true;"
      );
      break;
    }
  }
  n++;
}
if (!t.includes('jobs["a4-G19-canary-partial-evidence"]')) {
  t = t.replace(
    "  return runHorizonOffline({",
    '  if (!jobs["a4-G19-canary-partial-evidence"] && workspace && includeG19) {\n' +
      '    jobs["a4-G19-canary-partial-evidence"] = await syntheticG19Job(\n' +
      '      path.join(workspace, "g19")\n' +
      "    );\n" +
      "  }\n" +
      "  return runHorizonOffline({"
  );
  n++;
}
if (!t.includes('includeG19 ? ["a4-G19-canary-partial-evidence"]')) {
  for (const prev of [
    '...(includeG18 ? ["a4-G18-oauth-refresh-midrun"] : []),',
    '...(includeG17 ? ["a4-G17-overnight-soak"] : []),',
    '...(includeG16 ? ["a4-G16-swarm-ballot-merge"] : []),',
    '...(includeG15 ? ["a4-G15-browser-form-fill"] : []),',
    '...(includeG14 ? ["a4-G14-multi-file-refactor"] : []),',
  ]) {
    if (t.includes(prev)) {
      t = t.replace(
        prev,
        prev +
          '\n      ...(includeG19 ? ["a4-G19-canary-partial-evidence"] : []),' 
      );
      n++;
      break;
    }
  }
}

fs.writeFileSync(fp, t);
console.log(JSON.stringify({ ok: true, applied: n }));
