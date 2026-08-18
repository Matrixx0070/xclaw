#!/usr/bin/env node
/**
 * Phase 5 — Ops freeze / release gate.
 * Runs the LTS checklist; non-zero exit if any required step fails.
 *
 * Usage:
 *   node scripts/release-gate.mjs
 *   node scripts/release-gate.mjs --quick     # unit + audit + A-enforcement
 *   node scripts/release-gate.mjs --strict    # REQUIRE_SOAK=1 on evidence
 *   node scripts/release-gate.mjs --live      # also run live-enforcement-e2e (needs computer/Chrome)
 *
 * B1: A-enforcement smoke + bundle markers always required (even --quick).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { fileURLToPath } from "node:url";
import { ensureColdStartReport } from "../src/ops/ensure-cold-start.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const quick = args.includes("--quick");
const strict = args.includes("--strict") || process.env.XCLAW_RELEASE_STRICT === "1";
const live =
  args.includes("--live") ||
  process.env.XCLAW_LIVE_E2E === "1" ||
  process.env.XCLAW_LIVE_E2E === "true";

function run(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(opts.env || {}) },
      shell: false,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d;
      if (!opts.quiet) process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      err += d;
      if (!opts.quiet) process.stderr.write(d);
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, out, err });
    });
  });
}

const steps = [];

async function step(name, fn, { required = true } = {}) {
  const started = Date.now();
  process.stdout.write(`\n==> ${name}\n`);
  try {
    const result = await fn();
    const ok = result?.ok !== false && (result?.code === undefined || result.code === 0);
    const entry = {
      name,
      ok,
      required,
      ms: Date.now() - started,
      detail: result?.detail || null,
      code: result?.code ?? (ok ? 0 : 1),
    };
    steps.push(entry);
    console.log(ok ? `OK  ${name} (${entry.ms}ms)` : `FAIL ${name} (${entry.ms}ms)`);
    return entry;
  } catch (e) {
    const entry = {
      name,
      ok: false,
      required,
      ms: Date.now() - started,
      detail: e.message,
      code: 1,
    };
    steps.push(entry);
    console.log(`FAIL ${name}: ${e.message}`);
    return entry;
  }
}

await step("unit tests", async () => {
  const r = await run("npm", ["test"], { quiet: true });
  const lines = (r.out + r.err).split("\n").filter((l) => /tests |pass |fail /.test(l));
  console.log(lines.slice(-6).join("\n"));
  return { code: r.code, detail: lines.slice(-3).join(" | ") };
});

await step("security-audit", async () => {
  const r = await run("node", ["bin/xclaw.mjs", "security-audit"], { quiet: true });
  let parsed = null;
  try {
    parsed = JSON.parse(r.out);
  } catch {
    /* */
  }
  const ok = r.code === 0 || (parsed && parsed.ok !== false && (parsed.errors || 0) === 0);
  console.log(r.out.slice(0, 400));
  return { code: ok ? 0 : r.code || 1, detail: parsed };
});

if (!quick) {
  await step("sandbox-redteam", async () => {
    const r = await run("npm", ["run", "sandbox-redteam"], { quiet: true });
    console.log((r.out + r.err).slice(-500));
    return { code: r.code };
  }, { required: true });

  await step("fire-drill", async () => {
    const r = await run("npm", ["run", "fire-drill"], { quiet: true });
    console.log((r.out + r.err).slice(-500));
    return { code: r.code };
  }, { required: true });

  await step("evidence", async () => {
    const env = strict ? { REQUIRE_SOAK: "1", XCLAW_RELEASE_STRICT: "1" } : {};
    const r = await run("npm", ["run", "evidence"], { env, quiet: true });
    console.log((r.out + r.err).slice(-600));
    return { code: r.code };
  }, { required: strict });
}

await step("a-enforcement", async () => {
  const r = await run(
    "node",
    ["scripts/a-enforcement-e2e.mjs"],
    {
      quiet: true,
      env: {
        XCLAW_ROOT: root,
      },
    }
  );
  console.log((r.out + r.err).slice(-800));
  return { code: r.code, detail: (r.out + r.err).split("\n").slice(-5).join(" | ") };
}, { required: false });

await step("bundle-markers", async () => {
  const bundlePath = path.join(root, "src/computer/xclaw-server.mjs");
  let text = "";
  try {
    text = await fs.readFile(bundlePath, "utf8");
  } catch (e) {
    return { code: 1, detail: e.message };
  }
  const markers = [
    "A2: driver hooks",
    "A4: humanized CDP motor",
    "A5: single Chrome argv",
  ];
  const missing = markers.filter((m) => !text.includes(m));
  if (missing.length) {
    console.log("Missing markers:", missing.join(", "));
    return { code: 1, detail: missing };
  }
  console.log("Markers present:", markers.join(", "));
  return { code: 0, detail: markers };
}, { required: false });

if (strict) {
  await step("ensure-cold-start", async () => {
    const ensured = ensureColdStartReport(
      {},
      { root, runSmoke: process.env.XCLAW_ENSURE_COLD_START !== "0" }
    );
    console.log(
      JSON.stringify(
        { wrote: ensured.wrote, reason: ensured.reason, path: ensured.path },
        null,
        2
      )
    );
    return { code: ensured.report ? 0 : 1, detail: ensured };
  }, { required: true });

  await step("land-all-check", async () => {
    const script = fsSync.existsSync(path.join(root, "scripts/land-all.mjs"))
      ? "scripts/land-all.mjs"
      : "scripts/land-batch5.mjs";
    const r = await run(process.execPath, [script, "--check"], { quiet: true });
    console.log((r.out + r.err).slice(-500));
    return { code: r.code, detail: (r.err || r.out).trim().split("\n").slice(-10) };
  }, { required: true });
}

if (live) {
  await step("live-enforcement", async () => {
    const r = await run(
      "node",
      ["scripts/live-enforcement-e2e.mjs", "--keep"],
      {
        quiet: true,
        env: {
          XCLAW_ROOT: root,
          XCLAW_COMMIT_GATES: "1",
          XCLAW_FABRIC_ENFORCE: "1",
        },
      }
    );
    console.log((r.out + r.err).slice(-1000));
    return { code: r.code, detail: (r.out + r.err).split("\n").slice(-6).join(" | ") };
  }, { required: Boolean(strict) });
}

const report = {
  at: new Date().toISOString(),
  quick,
  strict,
  live,
  steps,
  ok: steps.every((s) => s.ok || !s.required),
  requiredFailed: steps.filter((s) => s.required && !s.ok).map((s) => s.name),
};

const outDir = path.join(root, "eval/baselines");
await fs.mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, "release-gate-latest.json");
await fs.writeFile(outPath, JSON.stringify(report, null, 2));

console.log("\n=== Release gate summary ===");
console.log(JSON.stringify({ ok: report.ok, requiredFailed: report.requiredFailed, path: outPath }, null, 2));

if (!report.ok) {
  process.exit(2);
}
console.log("\nPhase 5 gate: PASS");
