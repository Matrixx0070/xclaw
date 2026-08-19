#!/usr/bin/env node
/** Idempotent: add syntheticG15Job + includeG15 to horizon-offline.mjs */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fp = path.join(root, "src/eval/horizon-offline.mjs");
let t = fs.readFileSync(fp, "utf8");
let n = 0;

if (!t.includes("horizon-g15-metrics")) {
  t = t.replace(
    'import { incG14Pass } from "./horizon-g14-metrics.mjs";',
    'import { incG14Pass } from "./horizon-g14-metrics.mjs";\nimport { incG15Pass } from "./horizon-g15-metrics.mjs";'
  );
  n++;
}
if (!t.includes('id.includes("G15")')) {
  t = t.replace(
    'if (id.includes("G14")) incG14Pass();',
    'if (id.includes("G14")) incG14Pass();\n      if (id.includes("G15")) incG15Pass();'
  );
  n++;
}
if (!t.includes("syntheticG15Job")) {
  const block =
    `\nexport async function syntheticG15Job(workspace) {\n` +
    `  await fs.mkdir(workspace, { recursive: true });\n` +
    `  await fs.writeFile(path.join(workspace, "form.html"), "<html><body>form mock</body></html>\\n");\n` +
    `  await fs.writeFile(path.join(workspace, "result.txt"), "SUBMITTED-OK\\n");\n` +
    `  return {\n` +
    `    text: "Filled form via browser mock and wrote result.txt SUBMITTED-OK",\n` +
    `    turns: 3,\n` +
    `    toolTrace: [\n` +
    `      { name: "xclaw_browser_tab", status: "ok" },\n` +
    `      { name: "xclaw_browser_tab", status: "ok" },\n` +
    `      { name: "xclaw_file_write", status: "ok" },\n` +
    `    ],\n` +
    `    toolCalls: 3,\n` +
    `    toolErrors: 0,\n` +
    `    wallMs: 45,\n` +
    `    status: "succeeded",\n` +
    `    workspace,\n` +
    `  };\n` +
    `}\n`;
  t = t.replace(
    "export default {",
    block + "\nexport default {"
  );
  if (!t.includes("syntheticG15Job,")) {
    t = t.replace("syntheticG14Job,", "syntheticG14Job,\n  syntheticG15Job,");
  }
  n++;
}
if (!t.includes("includeG15")) {
  t = t.replace(
    "const includeG14 = opts.includeG14 !== false;",
    "const includeG14 = opts.includeG14 !== false;\n  const includeG15 = opts.includeG15 === true;"
  );
  t = t.replace(
    `  if (!jobs["a4-G14-multi-file-refactor"] && workspace && includeG14) {\n    jobs["a4-G14-multi-file-refactor"] = await syntheticG14Job(\n      path.join(workspace, "g14")\n    );\n  }\n  return runHorizonOffline({`,
    `  if (!jobs["a4-G14-multi-file-refactor"] && workspace && includeG14) {\n    jobs["a4-G14-multi-file-refactor"] = await syntheticG14Job(\n      path.join(workspace, "g14")\n    );\n  }\n  if (!jobs["a4-G15-browser-form-fill"] && workspace && includeG15) {\n    jobs["a4-G15-browser-form-fill"] = await syntheticG15Job(\n      path.join(workspace, "g15")\n    );\n  }\n  return runHorizonOffline({`
  );
  t = t.replace(
    `...(includeG14 ? ["a4-G14-multi-file-refactor"] : []),\n    ],`,
    `...(includeG14 ? ["a4-G14-multi-file-refactor"] : []),\n      ...(includeG15 ? ["a4-G15-browser-form-fill"] : []),\n    ],`
  );
  n++;
}

fs.writeFileSync(fp, t);
console.log(JSON.stringify({ ok: true, applied: n }));
