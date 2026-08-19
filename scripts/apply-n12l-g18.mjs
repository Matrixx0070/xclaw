#!/usr/bin/env node
/** Idempotent: land syntheticG18Job + includeG18; also run apply-n12k-g17 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { writeSourceIfChanged } from "./lib/atomic-source-write.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const s of ["apply-n12k-g17.mjs", "apply-n12j-g16.mjs", "apply-n12i-g15.mjs"]) {
  const p = path.join(root, "scripts", s);
  if (fs.existsSync(p)) spawnSync(process.execPath, [p], { cwd: root, encoding: "utf8" });
}

const fp = path.join(root, "src/eval/horizon-offline.mjs");
let t = fs.readFileSync(fp, "utf8");
let n = 0;

if (!t.includes("horizon-g18-metrics")) {
  const anchors = [
    'import { incG17Pass } from "./horizon-g17-metrics.mjs";',
    'import { incG16Pass } from "./horizon-g16-metrics.mjs";',
    'import { incG15Pass } from "./horizon-g15-metrics.mjs";',
    'import { incG14Pass } from "./horizon-g14-metrics.mjs";',
  ];
  for (const prev of anchors) {
    if (t.includes(prev)) {
      t = t.replace(
        prev,
        prev + '\nimport { incG18Pass } from "./horizon-g18-metrics.mjs";'
      );
      n++;
      break;
    }
  }
}
if (!t.includes('id.includes("G18")')) {
  for (const g of ["G17", "G16", "G15", "G14"]) {
    const needle = `if (id.includes("${g}")) inc${g}Pass();`;
    if (t.includes(needle)) {
      t = t.replace(
        needle,
        needle + '\n      if (id.includes("G18")) incG18Pass();'
      );
      n++;
      break;
    }
  }
}
if (!t.includes("syntheticG18Job")) {
  const block = [
    "",
    "export async function syntheticG18Job(workspace) {",
    "  await fs.mkdir(workspace, { recursive: true });",
    '  await fs.writeFile(path.join(workspace, "done.txt"), "OAUTH-OK\\n");',
    "  await fs.writeFile(",
    '    path.join(workspace, "tokens-out.json"),',
    '    JSON.stringify({ refreshed: true, accessToken: "new-access" }) + "\\n"',
    "  );",
    "  return {",
    '    text: "Refreshed OAuth mid-run; wrote done.txt",',
    "    turns: 3,",
    "    toolTrace: [",
    '      { name: "xclaw_file_read", status: "ok" },',
    '      { name: "auth_refresh", status: "ok" },',
    '      { name: "xclaw_file_write", status: "ok" },',
    "    ],",
    "    toolCalls: 3,",
    "    toolErrors: 0,",
    "    wallMs: 35,",
    '    status: "succeeded",',
    "    workspace,",
    "  };",
    "}",
    "",
  ].join("\n");
  t = t.replace("export default {", block + "export default {");
  for (const s of [
    "syntheticG17Job,",
    "syntheticG16Job,",
    "syntheticG15Job,",
    "syntheticG14Job,",
  ]) {
    if (t.includes(s) && !t.includes("syntheticG18Job,")) {
      t = t.replace(s, s + "\n  syntheticG18Job,");
      break;
    }
  }
  n++;
}
if (!t.includes("includeG18")) {
  for (const prev of [
    "const includeG17 = opts.includeG17 === true;",
    "const includeG16 = opts.includeG16 === true;",
    "const includeG15 = opts.includeG15 === true;",
    "const includeG14 = opts.includeG14 !== false;",
  ]) {
    if (t.includes(prev)) {
      t = t.replace(
        prev,
        prev + "\n  const includeG18 = opts.includeG18 === true;"
      );
      break;
    }
  }
  n++;
}
if (!t.includes('jobs["a4-G18-oauth-refresh-midrun"]')) {
  t = t.replace(
    "  return runHorizonOffline({",
    '  if (!jobs["a4-G18-oauth-refresh-midrun"] && workspace && includeG18) {\n' +
      '    jobs["a4-G18-oauth-refresh-midrun"] = await syntheticG18Job(\n' +
      '      path.join(workspace, "g18")\n' +
      "    );\n" +
      "  }\n" +
      "  return runHorizonOffline({"
  );
  n++;
}
if (!t.includes('includeG18 ? ["a4-G18-oauth-refresh-midrun"]')) {
  for (const prev of [
    '...(includeG17 ? ["a4-G17-overnight-soak"] : []),',
    '...(includeG16 ? ["a4-G16-swarm-ballot-merge"] : []),',
    '...(includeG15 ? ["a4-G15-browser-form-fill"] : []),',
    '...(includeG14 ? ["a4-G14-multi-file-refactor"] : []),',
  ]) {
    if (t.includes(prev)) {
      t = t.replace(
        prev,
        prev + '\n      ...(includeG18 ? ["a4-G18-oauth-refresh-midrun"] : []),' 
      );
      n++;
      break;
    }
  }
}

writeSourceIfChanged(fp, t);
console.log(JSON.stringify({ ok: true, applied: n }));
