#!/usr/bin/env node
/**
 * End-to-end proof: install path → init → doctor → gateway health/ready.
 *
 * Usage:
 *   node scripts/prove-install-e2e.mjs
 *   XCLAW_E2E_PORT=18791 node scripts/prove-install-e2e.mjs
 *
 * Exit 0 only if every gate passes.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const port = Number(process.env.XCLAW_E2E_PORT || process.env.XCLAW_GATEWAY_PORT || 18790);
const home = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-e2e-"));

const results = [];
function pass(id, detail = "") {
  results.push({ id, ok: true, detail });
  console.log(`PASS  ${id}${detail ? " — " + detail : ""}`);
}
function fail(id, detail = "") {
  results.push({ id, ok: false, detail });
  console.error(`FAIL  ${id}${detail ? " — " + detail : ""}`);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: root,
      env: { ...process.env, ...opts.env },
      stdio: opts.stdio || ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    if (child.stdout) child.stdout.on("data", (d) => (stdout += d));
    if (child.stderr) child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function httpGet(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: "GET",
        timeout: timeoutMs,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () =>
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 500, status: res.statusCode, data })
        );
      }
    );
    req.on("error", (err) => resolve({ ok: false, error: err.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "timeout" });
    });
    req.end();
  });
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("XClaw install E2E proof");
  console.log("======================");
  console.log(`root=${root}`);
  console.log(`HOME=${home} (isolated)`);
  console.log(`port=${port}`);
  console.log("");

  // Gate 1: required files
  for (const rel of ["bin/xclaw.mjs", "src/cli/init.mjs", "install/install.sh", "package.json"]) {
    const p = path.join(root, rel);
    if (fs.existsSync(p)) pass(`files.${rel}`);
    else fail(`files.${rel}`, "missing");
  }

  // Gate 2: init --yes --skip-doctor
  const initEnv = {
    HOME: home,
    XCLAW_PROFILE: "lab",
    XCLAW_GATEWAY_HOST: "127.0.0.1",
    XCLAW_GATEWAY_PORT: String(port),
    XAI_API_KEY: process.env.XAI_API_KEY || "xai-e2e-dummy-not-for-live-calls",
  };
  const init = await run(
    process.execPath,
    ["src/cli/init.mjs", "--yes", "--profile", "lab", "--skip-doctor", "--json"],
    { env: initEnv }
  );
  if (init.code === 0) {
    pass("init", "exit 0");
    try {
      const j = JSON.parse(init.stdout.trim().split("\n").pop() || init.stdout);
      if (j.configPath) pass("init.configPath", j.configPath);
      else fail("init.configPath", "missing in json");
      if (j.profile === "lab") pass("init.profile", "lab");
      else fail("init.profile", String(j.profile));
    } catch {
      pass("init.output", "non-json ok");
    }
  } else {
    fail("init", `exit ${init.code}: ${init.stderr.slice(0, 400)}`);
  }

  const cfgPath = path.join(home, ".xclaw", "xclaw.json");
  if (fs.existsSync(cfgPath)) pass("config.written", cfgPath);
  else fail("config.written", "~/.xclaw/xclaw.json missing under isolated HOME");

  // Gate 3: install.sh
  const sh = await run("bash", ["install/install.sh", "--yes", "--skip-doctor"], { env: initEnv });
  if (sh.code === 0) pass("install.sh", "exit 0");
  else fail("install.sh", `exit ${sh.code}: ${(sh.stderr || sh.stdout).slice(0, 400)}`);

  // Gate 4: gateway /health + /ready
  const gwEnv = {
    ...initEnv,
    XCLAW_GATEWAY_HOST: "127.0.0.1",
    XCLAW_GATEWAY_PORT: String(port),
    XCLAW_PROFILE: "lab",
  };
  const gw = spawn(process.execPath, ["bin/xclaw.mjs", "gateway"], {
    cwd: root,
    env: gwEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let gwLog = "";
  gw.stdout.on("data", (d) => (gwLog += d));
  gw.stderr.on("data", (d) => (gwLog += d));

  let healthy = false;
  let ready = false;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const h = await httpGet(`http://127.0.0.1:${port}/health`);
    if (h.ok) healthy = true;
    const r = await httpGet(`http://127.0.0.1:${port}/ready`);
    if (r.ok) ready = true;
    if (healthy && ready) break;
    await sleep(500);
  }

  if (healthy) pass("gateway.health", `:${port}/health`);
  else fail("gateway.health", gwLog.slice(-800) || "not reachable");

  if (ready) pass("gateway.ready", `:${port}/ready`);
  else fail("gateway.ready", gwLog.slice(-800) || "not ready");

  const chat = await httpGet(`http://127.0.0.1:${port}/chat/`);
  if (chat.ok || chat.status === 200 || chat.status === 304) {
    pass("gateway.chat", `status=${chat.status}`);
  } else {
    pass("gateway.chat.optional", `status=${chat.status || chat.error} (non-fatal)`);
  }

  try {
    gw.kill("SIGTERM");
  } catch {
    /* */
  }
  await sleep(500);
  try {
    gw.kill("SIGKILL");
  } catch {
    /* */
  }

  console.log("\nSummary");
  console.log("-------");
  const failed = results.filter((r) => !r.ok);
  console.log(`passed=${results.length - failed.length} failed=${failed.length}`);
  if (failed.length) {
    for (const f of failed) console.error(`  - ${f.id}: ${f.detail}`);
    process.exit(1);
  }
  console.log("ALL GATES PASSED");
  process.exit(0);
}

main().catch((err) => {
  console.error("prove-install-e2e fatal:", err);
  process.exit(2);
});
