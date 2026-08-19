#!/usr/bin/env node
/** Idempotent: land syntheticG16Job + includeG16; also run apply-n12i-g15 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const g15 = path.join(root, "scripts/apply-n12i-g15.mjs");
if (fs.existsSync(g15)) {
  spawnSync(process.execPath, [g15], { cwd: root, encoding: "utf8" });
}

const fp = path.join(root, "src/eval/horizon-offline.mjs");
let t = fs.readFileSync(fp, "utf8");
let n = 0;

if (!t.includes("horizon-g16-metrics")) {
  const needle = 'import { incG15Pass } from "./horizon-g15-metrics.mjs";';
  if (t.includes(needle)) {
    t = t.replace(
      needle,
      needle + '\nimport { incG16Pass } from "./horizon-g16-metrics.mjs";'
    );
    n++;
  } else if (t.includes("horizon-g14-metrics")) {
    t = t.replace(
      'import { incG14Pass } from "./horizon-g14-metrics.mjs";',
      'import { incG14Pass } from "./horizon-g14-metrics.mjs";\nimport { incG16Pass } from "./horizon-g16-metrics.mjs";'
    );
    n++;
  }
}
if (!t.includes('id.includes("G16")')) {
  t = t.replace(
    'if (id.includes("G15")) incG15Pass();',
    'if (id.includes("G15")) incG15Pass();\n      if (id.includes("G16")) incG16Pass();'
  );
  if (!t.includes('id.includes("G16")')) {
    t = t.replace(
      'if (id.includes("G14")) incG14Pass();',
      'if (id.includes("G14")) incG14Pass();\n      if (id.includes("G16")) incG16Pass();'
    );
  }
  n++;
}
if (!t.includes("syntheticG16Job")) {
  const block = `\nexport async function syntheticG16Job(workspace) {\n  await fs.mkdir(workspace, { recursive: true });\n  await fs.writeFile(path.join(workspace, "verdict.txt"), "APPROVE\\n");\n  await fs.writeFile(\n    path.join(workspace, "receipt.json"),\n    JSON.stringify({ vote: "approve", ballots: ["a", "b", "c"] }) + "\\n"\n  );\n  return {\n    text: "Merged majority approve; wrote verdict + receipt",\n    turns: 3,\n    toolTrace: [\n      { name: "xclaw_file_read", status: "ok" },\n      { name: "xclaw_file_write", status: "ok" },\n      { name: "xclaw_file_write", status: "ok" },\n    ],\n    toolCalls: 3,\n    toolErrors: 0,\n    wallMs: 40,\n    status: "succeeded",\n    workspace,\n  };\n}\n`;
  t = t.replace("export default {", block + "\nexport default {");
  if (!t.includes("syntheticG16Job,")) {
    t = t.replace("syntheticG15Job,", "syntheticG15Job,\n  syntheticG16Job,");
    if (!t.includes("syntheticG16Job,")) {
      t = t.replace("syntheticG14Job,", "syntheticG14Job,\n  syntheticG16Job,");
    }
  }
  n++;
}
if (!t.includes("includeG16")) {
  t = t.replace(
    "const includeG15 = opts.includeG15 === true;",
    "const includeG15 = opts.includeG15 === true;\n  const includeG16 = opts.includeG16 === true;"
  );
  if (!t.includes("includeG16")) {
    t = t.replace(
      "const includeG14 = opts.includeG14 !== false;",
      "const includeG14 = opts.includeG14 !== false;\n  const includeG16 = opts.includeG16 === true;"
    );
  }
  t = t.replace(
    `  if (!jobs["a4-G15-browser-form-fill"] && workspace && includeG15) {\n    jobs["a4-G15-browser-form-fill"] = await syntheticG15Job(\n      path.join(workspace, "g15")\n    );\n  }\n  return runHorizonOffline({`,
    `  if (!jobs["a4-G15-browser-form-fill"] && workspace && includeG15) {\n    jobs["a4-G15-browser-form-fill"] = await syntheticG15Job(\n      path.join(workspace, "g15")\n    );\n  }\n  if (!jobs["a4-G16-swarm-ballot-merge"] && workspace && includeG16) {\n    jobs["a4-G16-swarm-ballot-merge"] = await syntheticG16Job(\n      path.join(workspace, "g16")\n    );\n  }\n  return runHorizonOffline({`
  );
  if (!t.includes("a4-G16-swarm-ballot-merge")) {
    t = t.replace(
      `  if (!jobs["a4-G14-multi-file-refactor"] && workspace && includeG14) {\n    jobs["a4-G14-multi-file-refactor"] = await syntheticG14Job(\n      path.join(workspace, "g14")\n    );\n  }\n  return runHorizonOffline({`,
      `  if (!jobs["a4-G14-multi-file-refactor"] && workspace && includeG14) {\n    jobs["a4-G14-multi-file-refactor"] = await syntheticG14Job(\n      path.join(workspace, "g14")\n    );\n  }\n  if (!jobs["a4-G16-swarm-ballot-merge"] && workspace && includeG16) {\n    jobs["a4-G16-swarm-ballot-merge"] = await syntheticG16Job(\n      path.join(workspace, "g16")\n    );\n  }\n  return runHorizonOffline({`
    );
  }
  t = t.replace(
    `...(includeG15 ? ["a4-G15-browser-form-fill"] : []),\n    ],`,
    `...(includeG15 ? ["a4-G15-browser-form-fill"] : []),\n      ...(includeG16 ? ["a4-G16-swarm-ballot-merge"] : []),\n    ],`
  );
  if (!t.includes("a4-G16-swarm-ballot-merge")) {
    t = t.replace(
      `...(includeG14 ? ["a4-G14-multi-file-refactor"] : []),\n    ],`,
      `...(includeG14 ? ["a4-G14-multi-file-refactor"] : []),\n      ...(includeG16 ? ["a4-G16-swarm-ballot-merge"] : []),\n    ],`
    );
  }
  n++;
}

fs.writeFileSync(fp, t);
console.log(JSON.stringify({ ok: true, applied: n }));
