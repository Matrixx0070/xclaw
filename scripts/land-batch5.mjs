#!/usr/bin/env node
/**
 * Apply authorize-quota-job + factory receipt collector + loop job pass.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

export const BATCH5 = [
  {
    file: "patches/authorize-quota-job.patch",
    target: "src/security/approvals.mjs",
    needles: ["authorizeQuotaPreflight", "job = null"],
  },
  {
    file: "patches/job-receipt-collector.patch",
    target: "src/jobs/job.mjs",
    needles: ["createReceiptCollector"],
  },
  {
    file: "patches/loop-authorize-job.patch",
    target: "src/agent/loop.mjs",
    needles: ["options.job || options.receiptCollector"],
  },
];

function applied(e) {
  const t = fs.readFileSync(path.join(root, e.target), "utf8");
  return e.needles.every((n) => t.includes(n));
}

function fallbackAuthorize() {
  const fp = path.join(root, "src/security/approvals.mjs");
  let t = fs.readFileSync(fp, "utf8");
  if (t.includes("authorizeQuotaPreflight")) return true;
  const sig =
    "async function authorize(name, args, { timeoutMs = 120_000, onPending, forceHuman = false, riskWorkingDir = null } = {}) {";
  const sig2 =
    "async function authorize(name, args, { timeoutMs = 120_000, onPending, forceHuman = false, riskWorkingDir = null, job = null } = {}) {";
  if (!t.includes(sig)) return false;
  t = t.replace(sig, sig2);
  const needle = "    // A2: deterministic risk assessment for every action.";
  const insert = `    try {\n      const { authorizeQuotaPreflight } = await import(\"./authorize-quota.mjs\");\n      const q = await authorizeQuotaPreflight(name, args, {\n        cfg,\n        workingDir: riskWorkingDir || args?.cwd || args?.workingDir || planRoot,\n        job,\n        hubs: cfg?._hubs || {},\n      });\n      if (q && q.ok === false) {\n        return {\n          ok: false,\n          reason: q.reason || \"WORKSPACE_QUOTA_EXCEEDED\",\n          message: q.message || \"workspace quota exceeded\",\n          quota: q.quota || null,\n          escalatedFromSoft: Boolean(q.escalatedFromSoft),\n        };\n      }\n    } catch {\n      /* quota optional */\n    }\n`;
  if (!t.includes(needle)) return false;
  t = t.replace(needle, insert + needle);
  fs.writeFileSync(fp, t);
  return applied(BATCH5[0]);
}

let need = 0;
let appliedN = 0;
for (const e of BATCH5) {
  if (applied(e)) {
    console.error(`[land-batch5] OK ${e.file}`);
    appliedN += 1;
    continue;
  }
  if (check) {
    console.error(`[land-batch5] NEED ${e.file}`);
    need += 1;
    continue;
  }
  const r = spawnSync("git", ["apply", "--whitespace=nowarn", path.join(root, e.file)], {
    cwd: root,
    encoding: "utf8",
  });
  if (r.status === 0 || applied(e)) {
    console.error(`[land-batch5] APPLIED ${e.file}`);
    appliedN += 1;
    continue;
  }
  if (e.file.includes("authorize-quota-job") && fallbackAuthorize()) {
    console.error(`[land-batch5] APPLIED ${e.file} (fallback)`);
    appliedN += 1;
    continue;
  }
  console.error(`[land-batch5] FAIL ${e.file}: ${(r.stderr || "").slice(0, 240)}`);
  process.exit(1);
}
if (check && need) process.exit(1);
console.error(`[land-batch5] done applied=${appliedN} need=${need}`);
process.exit(0);
