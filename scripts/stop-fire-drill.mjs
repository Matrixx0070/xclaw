#!/usr/bin/env node
/**
 * Single-port kill-switch fire-drill entrypoint for CI / ship-pack.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runStopFireDrill } from "../src/eval/stop-fire-drill.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const r = await runStopFireDrill({ root });
console.log(JSON.stringify(r, null, 2));
if (!r.ok) {
  console.error("[stop-fire-drill] FAILED", (r.failed || []).join(","));
  process.exit(1);
}
console.error("[stop-fire-drill] OK");
process.exit(0);
