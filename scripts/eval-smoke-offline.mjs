#!/usr/bin/env node
/**
 * Offline eval smoke gate (no API key).
 * 1) unit tests for smoke case load + mock suite
 * 2) xclaw eval --mock --tag smoke --out eval/baselines/last-mock.json (exit 0)
 *
 * Usage: node scripts/eval-smoke-offline.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "xclaw.mjs");
const outPath = path.join(root, "eval", "baselines", "last-mock.json");

function run(cmd, args) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { cwd: root, stdio: "inherit", env: process.env });
    c.on("exit", (code) => resolve(code ?? 1));
  });
}

const t = await run(process.execPath, ["--test", "test/eval-ci-smoke-offline.test.mjs"]);
if (t !== 0) process.exit(t);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const m = await run(process.execPath, [
  bin,
  "eval",
  "--mock",
  "--tag",
  "smoke",
  "--json",
  "--out",
  outPath,
]);
if (m === 0 && fs.existsSync(outPath)) {
  try {
    const rep = JSON.parse(fs.readFileSync(outPath, "utf8"));
    console.error(
      `[eval-smoke-offline] wrote ${outPath} total=${rep.total ?? "—"} mock=true`
    );
  } catch {
    /* */
  }
}
process.exit(m === 0 ? 0 : m);
