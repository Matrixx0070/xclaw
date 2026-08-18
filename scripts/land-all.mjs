#!/usr/bin/env node
/**
 * Apply all production wires (land-batch3/4/5) in one shot.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

function run(args, inherit = true) {
  return spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
  });
}

function tryApply(rel) {
  const fp = path.join(root, rel);
  if (!fs.existsSync(fp)) return false;
  const chk = spawnSync("git", ["apply", "--check", fp], { cwd: root, encoding: "utf8" });
  if (chk.status !== 0) return false;
  const a = spawnSync("git", ["apply", "--whitespace=nowarn", fp], { cwd: root, encoding: "utf8" });
  return a.status === 0;
}

if (check) {
  for (const b of ["land-batch3.mjs", "land-batch4.mjs", "land-batch5.mjs"]) {
    const r = run([path.join(root, "scripts", b), "--check"]);
    if ((r.status ?? 1) !== 0) process.exit(r.status || 1);
  }
  console.error("[land-all] check OK");
  process.exit(0);
}

const mega = "patches/land-all-wires.patch";
if (tryApply(mega)) {
  console.error(`[land-all] APPLIED ${mega}`);
} else {
  const splitDir = path.join(root, "patches/land-split");
  if (fs.existsSync(splitDir)) {
    for (const f of fs.readdirSync(splitDir).filter((x) => x.endsWith(".patch")).sort()) {
      const rel = path.join("patches/land-split", f);
      if (tryApply(rel)) console.error(`[land-all] APPLIED ${rel}`);
    }
  }
}

for (const b of ["land-batch3.mjs", "land-batch4.mjs", "land-batch5.mjs"]) {
  const r = run([path.join(root, "scripts", b)]);
  if ((r.status ?? 1) !== 0) {
    console.error(`[land-all] ${b} failed`);
    process.exit(r.status || 1);
  }
}
console.error("[land-all] apply OK");
process.exit(0);
