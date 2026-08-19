#!/usr/bin/env node
/**
 * xclaw eval horizon --offline
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { runHorizonSuiteOffline } from "./horizon-offline.mjs";
import { resetHorizonMetrics } from "./horizon-metrics.mjs";

export async function main(argv = process.argv.slice(2)) {
  const offline = argv.includes("--offline") || !argv.includes("--live");
  resetHorizonMetrics();
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-horizon-"));
  const r = await runHorizonSuiteOffline({ workspace });
  const out = { offline, ...r };
  console.log(JSON.stringify(out, null, 2));
  process.exitCode = r.ok ? 0 : 1;
  return out;
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("horizon-cli.mjs")
) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export default { main };
