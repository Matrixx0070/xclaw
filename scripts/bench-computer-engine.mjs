import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = "127.0.0.1";
const port = 4243;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function health() {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const req = http.get({ host, port, path: "/health", timeout: 5000 }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        resolve({
          ok: res.statusCode === 200,
          ms: performance.now() - t0,
          body: (() => {
            try {
              return JSON.parse(d);
            } catch {
              return d;
            }
          })(),
        });
      });
    });
    req.on("error", (e) => resolve({ ok: false, ms: performance.now() - t0, error: e.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, ms: performance.now() - t0, error: "timeout" });
    });
  });
}

async function waitHealthy(timeoutMs = 30000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    const h = await health();
    if (h.ok) return { ...h, readyMs: performance.now() - t0 };
    await sleep(100);
  }
  return { ok: false, readyMs: timeoutMs, error: "not healthy" };
}

function post(pathname, body) {
  const raw = JSON.stringify(body || {});
  return new Promise((resolve) => {
    const t0 = performance.now();
    const req = http.request(
      {
        host,
        port,
        path: pathname,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(raw),
        },
        timeout: 30000,
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          resolve({ status: res.statusCode, ms: performance.now() - t0, body: d.slice(0, 500) });
        });
      }
    );
    req.on("error", (e) => resolve({ status: 0, ms: performance.now() - t0, error: e.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, ms: performance.now() - t0, error: "timeout" });
    });
    req.write(raw);
    req.end();
  });
}

async function benchEngine(label, entryRel, envExtra = {}) {
  fuserKill();
  await sleep(400);
  const entry = path.join(root, entryRel);
  if (!fs.existsSync(entry)) {
    return { label, error: `missing ${entryRel}`, entryBytes: null };
  }
  const entryBytes = fs.statSync(entry).size;
  const tSpawn = performance.now();
  const child = spawn(process.execPath, [entry], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      XCLAW_COMPUTER_HOST: host,
      XCLAW_COMPUTER_PORT: String(port),
      ...envExtra,
    },
    stdio: "ignore",
  });
  const ready = await waitHealthy(45000);
  const spawnToReady = performance.now() - tSpawn;

  if (!ready.ok) {
    try {
      child.kill("SIGTERM");
    } catch {}
    return { label, entryBytes, error: ready.error || "unhealthy", spawnToReadyMs: round(spawnToReady) };
  }

  // session + tool latency
  const sess = await post("/xclaw/sessions/create", { workingDir: root });
  let sessionId = null;
  try {
    sessionId = JSON.parse(sess.body).sessionId;
  } catch {}

  const list = sessionId
    ? await post(`/xclaw/sessions/${sessionId}/tools/list`, { method: "tools/list" })
    : { ms: null };

  const bashSamples = [];
  if (sessionId) {
    for (let i = 0; i < 5; i++) {
      const r = await post(`/xclaw/sessions/${sessionId}/tools/call`, {
        name: "xclaw_bash",
        arguments: { command: "echo bench_$RANDOM", timeout: 10 },
      });
      bashSamples.push(r.ms);
    }
  }

  const healthSamples = [];
  for (let i = 0; i < 10; i++) {
    healthSamples.push((await health()).ms);
  }

  try {
    child.kill("SIGTERM");
  } catch {}
  await sleep(300);
  fuserKill();

  return {
    label,
    entry,
    entryBytes,
    entryMB: round(entryBytes / (1024 * 1024), 2),
    spawnToReadyMs: round(spawnToReady),
    firstHealthMs: round(ready.ms),
    engine: ready.body?.engine || ready.body?.status,
    tools: ready.body?.tools?.length ?? null,
    sessionCreateMs: round(sess.ms),
    toolsListMs: round(list.ms),
    bashMs: stats(bashSamples),
    healthMs: stats(healthSamples),
  };
}

function fuserKill() {
  try {
    spawn("fuser", ["-k", `${port}/tcp`], { stdio: "ignore" }).on("error", () => {});
  } catch {}
}

function round(n, d = 1) {
  if (n == null || !Number.isFinite(n)) return null;
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

function stats(arr) {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const sum = a.reduce((s, x) => s + x, 0);
  return {
    n: a.length,
    min: round(a[0]),
    p50: round(a[Math.floor(a.length / 2)]),
    p95: round(a[Math.min(a.length - 1, Math.floor(a.length * 0.95))]),
    max: round(a[a.length - 1]),
    avg: round(sum / a.length),
  };
}

const results = [];
results.push(
  await benchEngine("thin-native", "src/computer/thin-server.mjs", {
    XCLAW_COMPUTER_ENGINE: "native",
  })
);
await sleep(500);
results.push(
  await benchEngine("bundle", "src/computer/xclaw-server.mjs", {
    XCLAW_COMPUTER_ENGINE: "bundle",
  })
);

const out = {
  at: new Date().toISOString(),
  host,
  port,
  results,
};
console.log(JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(root, "tmp-live/bench-computer.json"), JSON.stringify(out, null, 2));
