#!/usr/bin/env bash
# Live G10–G14 pack under $2. Default is dry-run.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export XCLAW_SOAK_MAX_USD="${XCLAW_SOAK_MAX_USD:-2}"
export XCLAW_SOAK_MAX_TURNS="${XCLAW_SOAK_MAX_TURNS:-8}"
EV="$ROOT/.xclaw-evidence"
mkdir -p "$EV"

if [[ "${XCLAW_SOAK_CONFIRM:-0}" == "1" ]]; then
  node src/eval/horizon-cli.mjs --live --confirm-live --soak-job nightly \
    | tee "$EV/last-live-nightly.json"
else
  node src/eval/horizon-cli.mjs --live \
    | tee "$EV/last-soak-dry.json"
  echo "live G10-G14 dry-run only (set XCLAW_SOAK_CONFIRM=1 to spend, cap=\$XCLAW_SOAK_MAX_USD)"
fi
