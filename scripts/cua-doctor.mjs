#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { runCuaDoctor } from "../src/computer/cua-doctor.mjs";

const report = await runCuaDoctor(process.env);
const outDir = path.join(process.cwd(), "reports/autonomy");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "cua-doctor.json");
fs.writeFileSync(out, JSON.stringify(report, null, 2));

for (const c of report.checks) {
  const tag = c.severity === "ok" ? "OK  " : c.severity === "warn" ? "WARN" : c.severity === "error" ? "ERR " : "INFO";
  console.log(`${tag}  ${c.id}: ${c.message}`);
  if (c.hint) {
    for (const line of String(c.hint).split("\n")) console.log(`      → ${line}`);
  }
}
console.log(`\nsummary errors=${report.errors} warnings=${report.warnings} → ${out}`);
process.exit(report.errors ? 2 : report.warnings ? 1 : 0);
