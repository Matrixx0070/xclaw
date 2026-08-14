#!/usr/bin/env node
/**
 * Automated migration: normalize receipt.status to RECEIPT_STATUS_ENUM.
 *
 * Usage:
 *   node scripts/migrate-receipt-status.mjs                  # dry-run default configDir
 *   node scripts/migrate-receipt-status.mjs --write          # apply
 *   node scripts/migrate-receipt-status.mjs --dir /path/to/receipts --write
 *   node scripts/migrate-receipt-status.mjs --all-runs --write
 *   node scripts/migrate-receipt-status.mjs --fix-ok --write
 *   node scripts/migrate-receipt-status.mjs --require-pre-valid --write
 *
 * Scans ~/.xclaw/swarms/runs/<swarmId>/receipts by default (or cfg paths.configDir).
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  migrateReceiptsInDir,
  RECEIPT_STATUS_ENUM,
} from "../src/agents/swarm-receipt.mjs";

const args = process.argv.slice(2);
function flag(name) {
  return args.includes(name);
}
function opt(name, def = null) {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return def;
}

const write = flag("--write") || flag("--apply");
const dryRun = !write;
const fixOk = flag("--fix-ok");
const requirePreValid = flag("--require-pre-valid");
const allRuns = flag("--all-runs");
const singleDir = opt("--dir");
const configDir =
  opt("--config-dir") ||
  process.env.XCLAW_CONFIG_DIR ||
  path.join(os.homedir(), ".xclaw");

async function listReceiptDirs(root) {
  const runsRoot = path.join(root, "swarms", "runs");
  let runs = [];
  try {
    runs = await fs.readdir(runsRoot);
  } catch {
    return [];
  }
  const dirs = [];
  for (const r of runs) {
    const d = path.join(runsRoot, r, "receipts");
    try {
      const st = await fs.stat(d);
      if (st.isDirectory()) dirs.push(d);
    } catch {
      /* */
    }
  }
  return dirs;
}

const report = {
  at: new Date().toISOString(),
  dryRun,
  write,
  fixOk,
  requirePreValid,
  statusEnum: [...RECEIPT_STATUS_ENUM],
  dirs: [],
  totals: { files: 0, changed: 0, written: 0, invalid: 0 },
};

let dirs = [];
if (singleDir) {
  dirs = [path.resolve(singleDir)];
} else if (allRuns || !singleDir) {
  dirs = await listReceiptDirs(configDir);
  if (!dirs.length && !allRuns) {
    // still ok — nothing to migrate
  }
}

if (!dirs.length) {
  console.log(
    JSON.stringify(
      {
        ...report,
        ok: true,
        message: `No receipt dirs under ${configDir}/swarms/runs (nothing to migrate)`,
      },
      null,
      2
    )
  );
  process.exit(0);
}

for (const dir of dirs) {
  const r = await migrateReceiptsInDir(dir, {
    write,
    dryRun,
    fixOk,
    preferErrorOnFail: fixOk,
    requirePreValid,
    hooks: {
      onSkip: ({ file, reason, detail }) => {
        console.error(`[skip] ${file}: ${reason}`, detail || "");
      },
    },
  });
  report.dirs.push({
    dir,
    changed: r.changed,
    dryRun: r.dryRun,
    results: r.results,
  });
  for (const row of r.results || []) {
    report.totals.files += 1;
    if (row.changed) report.totals.changed += 1;
    if (row.written) report.totals.written += 1;
    if (row.shapeOk === false) report.totals.invalid += 1;
  }
}

report.ok = report.totals.invalid === 0;
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(2);
if (dryRun && report.totals.changed > 0) {
  console.error(
    `\nDry-run: ${report.totals.changed} file(s) would change. Re-run with --write to apply.`
  );
}
process.exit(0);
