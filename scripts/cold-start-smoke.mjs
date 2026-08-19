#!/usr/bin/env node
/**
 * Cold-start smoke — gateway bind + /health under budget (default 5s).
 * Exit 0 if total ≤ maxMs; exit 1 on failure or over budget.
 * Env: XCLAW_COLD_START_MAX_MS=5000
 */
import http from "node:http";
import { performance } from "node:perf_hooks";
import { persistColdStartReport } from "../src/ops/cold-start-persist.mjs";

const maxMs = Number(process.env.XCLAW_COLD_START_MAX_MS) || 5000;
const t0 = performance.now();

function log(m) {
  console.error(`[cold-start] ${m}`);
}

function healthBody() {
  return JSON.stringify({
    ok: true,
    service: "XClaw Computer Server",
    uptimeMs: Math.round(performance.now() - t0),
  });
}

const importStart = performance.now();
const { checkReadiness } = await import("../src/gateway/readiness.mjs");
const importMs = performance.now() - importStart;

const server = http.createServer(async (req, res) => {
  if (req.url === "/health" || req.url?.startsWith("/health?")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(healthBody());
    return;
  }
  if (req.url === "/ready" || req.url === "/readiness") {
    try {
      const r = await checkReadiness({ readiness: { requireComputer: false } });
      res.writeHead(r.status || (r.ready ? 200 : 503), {
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify(r.body || r));
    } catch (e) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ready: false, error: String(e.message || e) }));
    }
    return;
  }
  res.writeHead(404);
  res.end();
});

const listenStart = performance.now();
await new Promise((resolve, reject) => {
  server.listen(0, "127.0.0.1", (err) => (err ? reject(err) : resolve()));
});
const port = server.address().port;
const listenMs = performance.now() - listenStart;

const healthStart = performance.now();
const health = await new Promise((resolve, reject) => {
  const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
    let body = "";
    res.on("data", (c) => (body += c));
    res.on("end", () => {
      resolve({ status: res.statusCode, body });
    });
  });
  req.on("error", reject);
  req.setTimeout(2000, () => {
    req.destroy();
    reject(new Error("health timeout"));
  });
});
const healthMs = performance.now() - healthStart;

server.close();

const totalMs = performance.now() - t0;
const report = {
  ok: health.status === 200 && totalMs <= maxMs,
  totalMs: Math.round(totalMs),
  maxMs,
  importMs: Math.round(importMs),
  listenMs: Math.round(listenMs),
  healthMs: Math.round(healthMs),
  healthStatus: health.status,
};

const saved = persistColdStartReport(report);
log(JSON.stringify({ ...report, saved: saved.path }));
console.log(JSON.stringify({ ...report, saved: saved.path }, null, 2));

if (health.status !== 200) {
  log("health not 200");
  process.exit(1);
}
if (totalMs > maxMs) {
  log(`cold start ${Math.round(totalMs)}ms > budget ${maxMs}ms`);
  process.exit(1);
}
process.exit(0);
