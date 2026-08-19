#!/usr/bin/env bash
# Nightly scorecard: soak dry-run then fail-closed scorecard.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
EV="$ROOT/.xclaw-evidence"
mkdir -p "$EV"
node src/eval/horizon-cli.mjs --live --all >"$EV/last-soak-dry.json" || true
node src/eval/horizon-scorecard-cli.mjs | tee "$EV/last-scorecard.json"
node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync(".xclaw-evidence/last-scorecard.json","utf8"));
if (!j.ok) process.exit(1);
if (j.hmacFail) process.exit(1);
if (j.missing && j.missing.length) process.exit(1);
console.log("scorecard ok");
'
