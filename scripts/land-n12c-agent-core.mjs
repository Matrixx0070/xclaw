#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const r = spawnSync(
  process.execPath,
  [path.join(root, "scripts/apply-n12b-loop-agent-core.mjs")],
  { encoding: "utf8", cwd: root }
);
console.log(r.stdout || "");
if (r.status !== 0) {
  console.error(r.stderr || "apply failed");
  process.exit(r.status || 1);
}
console.log("land-n12c agent-core OK");
