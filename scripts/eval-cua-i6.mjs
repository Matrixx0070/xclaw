#!/usr/bin/env node
/**
 * I6 — offline CUA long-horizon policy suite
 */
import fs from "node:fs";
import path from "node:path";
import { runCuaI6Suite, summarizeCuaRows } from "../src/eval/cua-graders.mjs";

const root = process.cwd();
const outDir = path.join(root, "reports/autonomy");
fs.mkdirSync(outDir, { recursive: true });

const rows = await runCuaI6Suite();
const report = {
  suite: "cua-i6",
  at: new Date().toISOString(),
  ...summarizeCuaRows(rows),
};

const out = path.join(outDir, "cua-i6.json");
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ pass: report.pass, total: report.total, passRate: report.passRate, out }, null, 2));
for (const r of rows) {
  console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id} ${r.detail || ""}`);
}
process.exit(report.fail ? 1 : 0);
