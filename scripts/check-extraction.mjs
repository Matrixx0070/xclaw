#!/usr/bin/env node
/**
 * P0 gate: print computer extraction status (exit 0 if status loads).
 * Usage: node scripts/check-extraction.mjs
 */
import { getExtractionStatus } from "../src/computer/extraction-status.mjs";

const s = await getExtractionStatus();
console.log(JSON.stringify(s, null, 2));
if (!s.ok) process.exit(1);
if (!s.cleanNativeTools?.length) {
  console.error("No clean native tools registered");
  process.exit(1);
}
console.error(
  `[check-extraction] clean tools: ${s.cleanNativeTools.join(", ")}`
);
process.exit(0);
