#!/usr/bin/env node
/** Apply doctor-land-all + gateway-land-wires (idempotent via markers). */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

const entries = [
  {
    file: "patches/doctor-land-all.patch",
    target: "src/cli/doctor.mjs",
    needles: ["pushSinglePortChecks", "pushPerfChecksEnsured", "mergePerfIntoChecks"],
  },
  {
    file: "patches/gateway-land-wires.patch",
    target: "src/gateway/index.mjs",
    needles: ["createLiveStreamWriter", "ensureApprovalDigestCronJob"],
  },
];

function applied(e) {
  const t = fs.readFileSync(path.join(root, e.target), "utf8");
  return e.needles.every((n) => t.includes(n));
}

let need = 0;
let appliedN = 0;
for (const e of entries) {
  if (applied(e)) {
    console.error(`[land] OK ${e.file}`);
    appliedN += 1;
    continue;
  }
  if (check) {
    console.error(`[land] NEED ${e.file}`);
    need += 1;
    continue;
  }
  const r = spawnSync("git", ["apply", "--whitespace=nowarn", path.join(root, e.file)], {
    cwd: root,
    encoding: "utf8",
  });
  if (r.status === 0 || applied(e)) {
    console.error(`[land] APPLIED ${e.file}`);
    appliedN += 1;
  } else {
    console.error(`[land] FAIL ${e.file}: ${(r.stderr || "").slice(0, 200)}`);
    process.exit(1);
  }
}
if (check && need) process.exit(1);
console.error(`[land] done applied=${appliedN} need=${need}`);
process.exit(0);
