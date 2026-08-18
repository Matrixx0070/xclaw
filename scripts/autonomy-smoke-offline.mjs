#!/usr/bin/env node
/**
 * Offline autonomy harness smoke — no API key.
 * Exit 0 when autonomy cases load and offline tests pass.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tests = [
  "test/autonomy-harness-offline.test.mjs",
  "test/autonomy-metrics-a4.test.mjs",
].filter(Boolean);

const r = spawnSync(process.execPath, ["--test", ...tests], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, XCLAW_AUTONOMY_SMOKE: "1" },
});
process.exit(r.status ?? 1);
