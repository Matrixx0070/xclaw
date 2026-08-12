#!/usr/bin/env node
/**
 * Build (and optionally push) XClaw Docker image (P6).
 *
 * Usage:
 *   node scripts/docker-publish.mjs
 *   node scripts/docker-publish.mjs --push
 *   XCLAW_IMAGE=ghcr.io/org/xclaw node scripts/docker-publish.mjs --push
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version || "0.0.0";
const imageBase = process.env.XCLAW_IMAGE || "xclaw";
const tags = [
  `${imageBase}:${version}`,
  `${imageBase}:latest`,
];
const push = process.argv.includes("--push");
const dockerfile = fs.existsSync(path.join(root, "Dockerfile"))
  ? "Dockerfile"
  : "deploy/Dockerfile";

function run(cmd, args) {
  console.log("+", cmd, args.join(" "));
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status || 1);
}

const buildArgs = ["build", "-f", dockerfile, "-t", tags[0], "-t", tags[1], "."];
run("docker", buildArgs);
console.log("Built", tags.join(", "));
if (push) {
  for (const t of tags) run("docker", ["push", t]);
  console.log("Pushed", tags.join(", "));
}
