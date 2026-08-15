#!/usr/bin/env node
/**
 * C4 optional soak — verify native / generated / bundle engine entries resolve
 * and exist. Does not start long-running servers or delete the bundle.
 *
 *   node scripts/c4-engine-soak.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveComputerEngine,
  resolveComputerEntryPath,
  describeComputerEngine,
} from "../src/computer/engine.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engines = ["native", "generated", "bundle"];
const report = {
  at: new Date().toISOString(),
  phase: "C4-soak",
  engines: [],
};

for (const eng of engines) {
  process.env.XCLAW_COMPUTER_ENGINE = eng;
  const cfg = { computer: { engine: eng } };
  const resolved = resolveComputerEngine(cfg);
  const entry = resolveComputerEntryPath(cfg, root);
  const info = describeComputerEngine(cfg, root);
  const exists = fs.existsSync(entry);
  const bytes = exists ? fs.statSync(entry).size : 0;
  let readable = false;
  if (exists) {
    try {
      const st = fs.statSync(entry);
      readable = st.isFile() && st.size > 0;
      // bundle is binary-ish large; only check size
      if (eng !== "bundle") {
        const head = fs.readFileSync(entry, "utf8").slice(0, 4000);
        readable = head.length > 0;
      }
    } catch {
      readable = false;
    }
  }
  report.engines.push({
    requested: eng,
    resolved,
    entry: path.relative(root, entry),
    exists,
    bytes,
    readable,
    strategyPhase: info.strategyPhase,
    isFallbackBundle: info.isFallbackBundle,
  });
}

const allExist = report.engines.every((e) => e.exists && e.readable);
const nativeOk = report.engines.find((e) => e.requested === "native");
const genOk = report.engines.find((e) => e.requested === "generated");
const bundleOk = report.engines.find((e) => e.requested === "bundle");

report.ok =
  Boolean(nativeOk?.exists) &&
  Boolean(genOk?.exists) &&
  Boolean(bundleOk?.exists) &&
  allExist;

report.summary = {
  allEnginesPresent: allExist,
  nativeBytes: nativeOk?.bytes,
  generatedBytes: genOk?.bytes,
  bundleBytes: bundleOk?.bytes,
  browserService: "bundle_only (intentionally not on native default path)",
  deleteBundle: false,
  note: "Soak confirms entries only; full process soak is release-gate / live-e2e",
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
  console.error("[c4-engine-soak] FAIL");
  process.exit(1);
}
console.error("[c4-engine-soak] OK — native + generated + bundle present");
process.exit(0);
