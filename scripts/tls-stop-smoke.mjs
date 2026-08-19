#!/usr/bin/env node
/**
 * Offline TLS stop parity smoke — asserts single-port markers exist.
 * Optional live: XCLAW_TLS_SMOKE_URL=https://127.0.0.1:port
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const markers = [
  ["src/gateway/stop-proxy.mjs", "tryHandleGatewayStop"],
  ["src/gateway/stop-route.mjs", "dryRun"],
  ["src/eval/stop-fire-drill.mjs", "fireDrillTlsParity"],
];
let fail = 0;
for (const [f, n] of markers) {
  const t = fs.readFileSync(path.join(root, f), "utf8");
  if (!t.includes(n)) {
    console.error("[tls-stop-smoke] NEED", f, n);
    fail++;
  }
}
if (fail) process.exit(1);
console.error("[tls-stop-smoke] offline markers OK");
if (process.env.XCLAW_TLS_SMOKE_URL) {
  console.error("[tls-stop-smoke] live URL set — operator must POST /stop with auth");
}
process.exit(0);
