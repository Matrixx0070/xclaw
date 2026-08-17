#!/usr/bin/env node
/**
 * Print / reset CUA retry metrics for the current process.
 * Note: in-process counters only apply after this process has performed CUA calls.
 * For historical data, tail ~/.xclaw/metrics/cua-retry.jsonl
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  getCuaRetryMetrics,
  resetCuaRetryMetrics,
} from "../src/computer/cua-retry-metrics.mjs";
import { withCuaRetry } from "../src/computer/cua-retry.mjs";

const cmd = process.argv[2] || "show";

if (cmd === "reset") {
  resetCuaRetryMetrics();
  console.log(JSON.stringify({ reset: true, ...getCuaRetryMetrics() }, null, 2));
  process.exit(0);
}

if (cmd === "demo") {
  // force a few transient retries for demo metrics
  let n = 0;
  await withCuaRetry(
    async () => {
      n += 1;
      if (n < 3) return { ok: false, code: "CDP_ATTACH_FAILED", error: "demo" };
      return { ok: true };
    },
    { retries: 3, baseMs: 5, maxMs: 20, jitter: 0 }
  );
}

if (cmd === "tail") {
  const p = path.join(
    process.env.XCLAW_CUA_METRICS_DIR ||
      path.join(process.env.HOME || os.homedir(), ".xclaw", "metrics"),
    "cua-retry.jsonl"
  );
  if (!fs.existsSync(p)) {
    console.log(JSON.stringify({ path: p, lines: [] }, null, 2));
    process.exit(0);
  }
  const lines = fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).slice(-30);
  console.log(JSON.stringify({ path: p, lines: lines.map((l) => JSON.parse(l)) }, null, 2));
  process.exit(0);
}

console.log(JSON.stringify(getCuaRetryMetrics(), null, 2));
