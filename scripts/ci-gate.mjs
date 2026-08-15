#!/usr/bin/env node
/**
 * C - CI gate (fast, required for merge confidence).
 *
 * Always: unit tests, skills smoke, p2 swarm + prod fire-drill.
 * Optional: live multistep eval when XCLAW_CI_LIVE=1 and API key present.
 *
 *   node scripts/ci-gate.mjs
 *   npm run ci
 */
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const live =
  process.env.XCLAW_CI_LIVE === "1" ||
  process.env.XCLAW_CI_LIVE === "true" ||
  process.argv.includes("--live");

function run(label, cmd, args) {
  return new Promise((resolve) => {
    const started = Date.now();
    console.log(`\n==> ${label}`);
    const child = spawn(cmd, args, {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (d) => process.stdout.write(d));
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.on("close", (code) => {
      const ms = Date.now() - started;
      const ok = (code ?? 1) === 0;
      console.log(`${ok ? "OK" : "FAIL"}  ${label} (${ms}ms)`);
      resolve({ label, ok, code: code ?? 1, ms });
    });
  });
}

function listTestFiles() {
  const dir = path.join(root, "test");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".test.mjs"))
    .map((f) => path.join("test", f));
}

const results = [];

const testFiles = listTestFiles();
results.push(
  await run("unit tests", process.execPath, ["--test", ...testFiles])
);
results.push(
  await run("C4 computer parity", process.execPath, [
    "scripts/check-computer-parity.mjs",
  ])
);
results.push(
  await run("C3 computer build", process.execPath, [
    "scripts/build-computer-bundle.mjs",
  ])
);
results.push(
  await run("skills smoke", process.execPath, ["scripts/p2-skills-smoke.mjs"])
);
results.push(
  await run("p2 swarm receipts", process.execPath, [
    "scripts/p2-swarm-receipt.mjs",
  ])
);
results.push(
  await run("p2 swarm fail path", process.execPath, [
    "scripts/p2-swarm-fail.mjs",
  ])
);
results.push(
  await run("p2 prod fire-drill", process.execPath, [
    "scripts/p2-prod-fire-drill.mjs",
  ])
);

const hasKey = Boolean(
  process.env.XAI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY
);

if (live) {
  if (!hasKey) {
    console.log("\n==> live multistep eval");
    console.log("SKIP  live eval (no API key in env)");
    results.push({
      label: "live multistep eval",
      ok: true,
      code: 0,
      ms: 0,
      skipped: true,
    });
  } else {
    results.push(
      await run("live multistep eval", process.execPath, [
        "scripts/p2-multistep-eval.mjs",
      ])
    );
  }
} else {
  console.log("\n==> live multistep eval");
  console.log("SKIP  (set XCLAW_CI_LIVE=1 and API key to enable)");
}

const failed = results.filter((r) => !r.ok && !r.skipped);
const report = {
  at: new Date().toISOString(),
  live,
  ok: failed.length === 0,
  steps: results.map((r) => ({
    label: r.label,
    ok: r.ok,
    code: r.code,
    ms: r.ms,
    skipped: Boolean(r.skipped),
  })),
};

console.log("\n-- CI gate summary --");
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
