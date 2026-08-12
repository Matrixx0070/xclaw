#!/usr/bin/env node
/**
 * CI eval gate (Phase A).
 * - No API key → mock eval only, exit 0
 * - With API key → wait-ready, run tag (default smoke), compare baseline, fail on regress
 *
 * Env:
 *   EVAL_TAG          case tag (default smoke)
 *   EVAL_WAIT_READY   set 0 to skip wait-ready
 *   EVAL_WAIT_MS      wait-ready timeout
 *   EVAL_FAIL_REGRESS set 0 to skip baseline fail
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "xclaw.mjs");
const key =
  process.env.XCLAW_API_KEY ||
  process.env.XAI_API_KEY ||
  process.env.OPENAI_API_KEY;

const tag = process.env.EVAL_TAG || "smoke";
const baselinePath = path.join(root, "eval", "baselines", "main.json");
const outPath = path.join(root, "eval", "baselines", "last-ci.json");

function run(args) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [bin, ...args], {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    c.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  // Phase M: computer contract unit tests (no Chromium)
  if (process.env.EVAL_SKIP_CONTRACT !== "1") {
    await new Promise((resolve) => {
      const c = spawn(
        process.execPath,
        ["--test", "test/computer-contract.test.mjs"],
        { cwd: root, env: process.env, stdio: "inherit" }
      );
      c.on("exit", (code) => {
        if (code) {
          console.error("[eval-ci] computer contract failed");
          process.exit(code);
        }
        resolve();
      });
    });
  }

  if (!key) {
    console.error("[eval-ci] no API key — mock only");
    process.exit(await run(["eval", "--mock", "--json"]));
  }

  if (process.env.EVAL_WAIT_READY !== "0") {
    const code = await run([
      "wait-ready",
      "--timeout",
      process.env.EVAL_WAIT_MS || "60000",
      "--interval",
      "500",
    ]);
    if (code !== 0) {
      console.error("[eval-ci] wait-ready failed");
      // still try computer ensure via status
      await run(["computer", "status", "--json"]);
      process.exit(code);
    }
  }

  const args = ["eval", "--tag", tag, "--json", "--out", outPath];
  if (
    process.env.EVAL_FAIL_REGRESS !== "0" &&
    fs.existsSync(baselinePath)
  ) {
    args.push("--baseline", baselinePath, "--fail-on-regress");
  }

  const code = await run(args);
  if (code === 0 && fs.existsSync(outPath)) {
    try {
      const rep = JSON.parse(fs.readFileSync(outPath, "utf8"));
      console.error(
        `[eval-ci] passRate=${((rep.passRate || 0) * 100).toFixed(1)}% tokens=${rep.tokens?.total ?? "—"} usd~${rep.cost?.usd ?? "—"}`
      );
    } catch {
      /* */
    }
  }
  process.exit(code);
}

main();
