#!/usr/bin/env node
/**
 * R1 soak helper — records heartbeat of computer + channel health.
 * Usage: node scripts/soak-r1.mjs [--hours 48] [--interval 60]
 * Run alongside: node bin/xclaw.mjs gateway
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

function arg(name, def) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return def;
}

const hours = Number(arg("--hours", "48"));
const intervalSec = Number(arg("--interval", "60"));
const outDir = path.join(os.homedir(), ".xclaw", "soak");
const outFile = path.join(outDir, `r1-${new Date().toISOString().slice(0, 10)}.jsonl`);

await fs.mkdir(outDir, { recursive: true });
const endAt = Date.now() + hours * 3600_000;
console.log(`[soak-r1] writing ${outFile} every ${intervalSec}s for ${hours}h`);
console.log(`[soak-r1] note: health modules reflect process that imported them; run inside gateway for live data or use doctor`);

while (Date.now() < endAt) {
  const row = { at: new Date().toISOString() };
  try {
    const { channelHealthStatus } = await import("../src/channels/health-watchdog.mjs");
    const { watchdogStatus } = await import("../src/computer/watchdog.mjs");
    row.channels = channelHealthStatus();
    row.computer = watchdogStatus();
  } catch (e) {
    row.error = e.message;
  }
  await fs.appendFile(outFile, JSON.stringify(row) + "\n");
  await new Promise((r) => setTimeout(r, intervalSec * 1000));
}
console.log("[soak-r1] done");
