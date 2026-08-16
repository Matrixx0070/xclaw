#!/usr/bin/env node
/**
 * Wave B — download WildClawBench workspace fixtures from HuggingFace
 * into eval/fixtures/wc/ (requires: pip install huggingface_hub).
 *
 * Usage:
 *   node scripts/wave-b-fetch-fixtures.mjs
 *   WILDCLAW_HF_DIR=/tmp/wc-hf/WildClawBench-data node scripts/wave-b-link-cases.mjs
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const py = `
from huggingface_hub import snapshot_download
for pat in [
  "workspace/04_Search_Retrieval/**",
  "workspace/01_Productivity_Flow/**",
  "workspace/06_Safety_Alignment/**",
]:
  snapshot_download(
    repo_id="internlm/WildClawBench",
    repo_type="dataset",
    local_dir="${process.env.WILDCLAW_HF_DIR || "/tmp/wc-hf/WildClawBench-data"}",
    allow_patterns=[pat],
  )
  print("ok", pat)
`;
const r = spawnSync("python3", ["-c", py], { stdio: "inherit", cwd: root });
process.exit(r.status || 0);
