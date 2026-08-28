#!/usr/bin/env node
/**
 * Single-port kill-switch fire-drill entrypoint for CI / ship-pack.
 */
import { runStopFireDrill } from "../src/eval/stop-fire-drill.mjs";

const r = await runStopFireDrill();
console.log(JSON.stringify(r, null, 2));
if (!r.ok) {
  console.error("[stop-fire-drill] FAILED", (r.failed || []).join(","));
  process.exit(1);
}
console.error("[stop-fire-drill] OK");
process.exit(0);
