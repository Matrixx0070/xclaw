#!/usr/bin/env node
/**
 * Build a release zip of the XClaw tree (source + eval + docs).
 * Usage: node scripts/package-release.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version || "0.0.0";
const outDir = path.resolve(root, "..");
const name = `XCLAW_RELEASE_v${version}.zip`;
const out = path.join(outDir, name);

const excludes = [
  "node_modules/*",
  ".git/*",
  "*.log",
  ".xclaw/*",
];

const args = ["-r", out, "xclaw"];
for (const e of excludes) {
  args.push("-x", `xclaw/${e}`);
}

// zip from parent so archive root is xclaw/
const r = spawnSync("zip", args, { cwd: outDir, stdio: "inherit" });
if (r.status !== 0) {
  console.error("zip failed", r.status);
  process.exit(r.status || 1);
}
const st = fs.statSync(out);
console.log(`Wrote ${out} (${(st.size / (1024 * 1024)).toFixed(2)} MB)`);
