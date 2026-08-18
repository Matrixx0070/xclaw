#!/usr/bin/env node
/**
 * Land remaining ship patches — only apply entries that still NEED markers.
 *
 * Usage:
 *   node scripts/land-remaining.mjs
 *   node scripts/land-remaining.mjs --check   # list NEED only, exit 1 if any
 *   node scripts/land-remaining.mjs --json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patchesDir = path.join(root, "patches");
const checkOnly = process.argv.includes("--check");
const json = process.argv.includes("--json");

function read(rootDir, rel) {
  const fp = path.join(rootDir, rel);
  if (!fs.existsSync(fp)) return "";
  return fs.readFileSync(fp, "utf8");
}

function log(m) {
  if (!json) console.error(`[land-remaining] ${m}`);
}

async function loadEntries() {
  const mod = await import("../src/ci/ship-patches-extra.mjs");
  return mod.extraShipEntries(read);
}

function applyOne(entry) {
  const patchPath = path.join(patchesDir, entry.file);
  if (!fs.existsSync(patchPath)) {
    return { file: entry.file, status: "missing" };
  }
  if (entry.isApplied(root)) {
    return { file: entry.file, status: "already" };
  }
  if (checkOnly) {
    return { file: entry.file, status: "need" };
  }
  const chk = spawnSync("git", ["apply", "--check", "--whitespace=nowarn", patchPath], {
    cwd: root,
    encoding: "utf8",
  });
  if (chk.status !== 0 && entry.isApplied(root)) {
    return { file: entry.file, status: "already" };
  }
  const r = spawnSync("git", ["apply", "--whitespace=nowarn", patchPath], {
    cwd: root,
    encoding: "utf8",
  });
  if (r.status === 0) {
    return { file: entry.file, status: "applied" };
  }
  if (entry.isApplied(root)) {
    return { file: entry.file, status: "already" };
  }
  return {
    file: entry.file,
    status: "fail",
    error: (r.stderr || r.stdout || "").slice(0, 200),
  };
}

const entries = await loadEntries();
const results = entries.map(applyOne);
const need = results.filter((r) => r.status === "need" || r.status === "fail");
const applied = results.filter((r) => r.status === "applied");
const already = results.filter((r) => r.status === "already");
const missing = results.filter((r) => r.status === "missing");

if (json) {
  console.log(
    JSON.stringify(
      {
        need: need.map((r) => r.file),
        applied: applied.map((r) => r.file),
        already: already.map((r) => r.file),
        missing: missing.map((r) => r.file),
        results,
      },
      null,
      2
    )
  );
} else {
  for (const r of results) {
    if (r.status === "already") continue;
    log(`${r.status.toUpperCase()} ${r.file}${r.error ? ": " + r.error : ""}`);
  }
  log(
    `summary need=${need.length} applied=${applied.length} already=${already.length} missing=${missing.length}`
  );
}

if (checkOnly) {
  process.exit(need.length ? 1 : 0);
}
if (results.some((r) => r.status === "fail")) {
  process.exit(1);
}
process.exit(0);
