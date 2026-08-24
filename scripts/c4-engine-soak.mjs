#!/usr/bin/env node
/**
 * Engine resolution soak — every selector (including retired legacy ones)
 * must resolve to the single native engine and its entry must exist.
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
const selectors = ["native", "thin", "generated", "gen", "c3", "bundle", "full", "xclaw-server", ""];
const report = {
  at: new Date().toISOString(),
  phase: "unified-native-soak",
  engines: [],
};

let fails = 0;
for (const sel of selectors) {
  if (sel) process.env.XCLAW_COMPUTER_ENGINE = sel;
  else delete process.env.XCLAW_COMPUTER_ENGINE;
  const cfg = sel ? { computer: { engine: sel } } : {};
  const resolved = resolveComputerEngine(cfg);
  const entry = resolveComputerEntryPath(cfg, root);
  const info = describeComputerEngine(cfg, root);
  const ok = resolved === "native" && fs.existsSync(entry);
  if (!ok) fails += 1;
  report.engines.push({
    selector: sel || "(default)",
    resolved,
    entry,
    entryExists: info.entryExists,
    ok,
  });
}

console.log(JSON.stringify(report, null, 2));
process.exit(fails ? 2 : 0);
