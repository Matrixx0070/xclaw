#!/usr/bin/env bash
# Nightly live soak wrapper — fail-closed without key / over budget
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export XCLAW_SOAK_MAX_USD="${XCLAW_SOAK_MAX_USD:-2}"
export XCLAW_SOAK_MAX_TURNS="${XCLAW_SOAK_MAX_TURNS:-8}"
cd "$ROOT"
# Dry-run first (never spends)
node src/eval/horizon-cli.mjs --live --all >/tmp/xclaw-soak-dry.json
# Only confirm when XCLAW_SOAK_CONFIRM=1
if [[ "${XCLAW_SOAK_CONFIRM:-0}" == "1" ]]; then
  node src/eval/horizon-cli.mjs --live --confirm-live --all
else
  echo "soak dry-run only (set XCLAW_SOAK_CONFIRM=1 to spend)"
  cat /tmp/xclaw-soak-dry.json
fi
