#!/usr/bin/env bash
# xclaw-run-with-retry.sh — exit-code-aware retries with exponential backoff strategies
#
# Usage:
#   ./scripts/xclaw-run-with-retry.sh "list /tmp"
#   ./scripts/xclaw-run-with-retry.sh --resume "$STREAM_ID" --last-event-id "$LAST_ID"
#
# Env:
#   XCLAW_BIN            xclaw binary (default: PATH or bin/xclaw.mjs)
#   XCLAW_MAX_TRIES      max attempts for retryable codes (default: 5)
#   XCLAW_BASE_MS        base delay ms (default: 1000)
#   XCLAW_MAX_MS         max delay ms (default: 30000)
#   XCLAW_BACKOFF        full|equal|decorrelated|none (default: full)
#   XCLAW_JSON_ERROR     if 1, pass --json-error

set -euo pipefail

XCLAW_BIN="${XCLAW_BIN:-}"
if [[ -z "$XCLAW_BIN" ]]; then
  if command -v xclaw >/dev/null 2>&1; then
    XCLAW_BIN="xclaw"
  else
    ROOT="$(cd "$(dirname "$0")/.." && pwd)"
    XCLAW_BIN="${ROOT}/bin/xclaw.mjs"
  fi
fi

MAX_TRIES="${XCLAW_MAX_TRIES:-5}"
BASE_MS="${XCLAW_BASE_MS:-1000}"
MAX_MS="${XCLAW_MAX_MS:-30000}"
STRATEGY="${XCLAW_BACKOFF:-full}"
JSON_ERR_FLAG=()
if [[ "${XCLAW_JSON_ERROR:-0}" == "1" ]]; then
  JSON_ERR_FLAG=(--json-error)
fi

is_retryable() {
  case "$1" in
    7) return 0 ;;
    *) return 1 ;;
  esac
}

# Exponential backoff with AWS-style jitter strategies.
# attempt is 0-based. Tracks PREV_DELAY_MS for decorrelated.
PREV_DELAY_MS=$BASE_MS

backoff_ms() {
  local attempt="$1"
  local exp=$(( BASE_MS * (1 << attempt) ))
  if (( exp > MAX_MS )); then exp=$MAX_MS; fi

  local d
  case "$STRATEGY" in
    none|exponential|exp)
      d=$exp
      ;;
    equal|equal_jitter)
      # half + U(0, half)
      local half=$(( exp / 2 ))
      if (( half < 1 )); then half=1; fi
      d=$(( half + RANDOM % (half + 1) ))
      ;;
    decorrelated|decorrelated_jitter)
      # U(base, min(max, prev*3))
      local hi=$(( PREV_DELAY_MS * 3 ))
      if (( hi > MAX_MS )); then hi=$MAX_MS; fi
      local lo=$BASE_MS
      if (( lo >= hi )); then
        d=$hi
      else
        d=$(( lo + RANDOM % (hi - lo + 1) ))
      fi
      ;;
    full|full_jitter|*)
      # U(0, exp)
      if (( exp < 1 )); then d=0; else d=$(( RANDOM % (exp + 1) )); fi
      ;;
  esac

  if (( d > MAX_MS )); then d=$MAX_MS; fi
  if (( d < 0 )); then d=0; fi
  PREV_DELAY_MS=$(( d > 0 ? d : BASE_MS ))
  echo "$d"
}

attempt=0
while (( attempt < MAX_TRIES )); do
  set +e
  "$XCLAW_BIN" run --backoff "$STRATEGY" --base-ms "$BASE_MS" --max-ms "$MAX_MS" \
    "${JSON_ERR_FLAG[@]}" "$@"
  code=$?
  set -e

  if (( code == 0 )); then
    exit 0
  fi

  if [[ "$code" == "2" ]]; then
    echo "[retry] fatal exit $code (STREAM_NOT_FOUND/EXPIRED) — not retrying resume" >&2
    exit "$code"
  fi

  if [[ "$code" == "3" || "$code" == "4" || "$code" == "5" ]]; then
    echo "[retry] non-retryable exit $code (AUTH/FORBIDDEN/BAD_REQUEST)" >&2
    exit "$code"
  fi

  if [[ "$code" == "130" ]]; then
    echo "[retry] aborted" >&2
    exit 130
  fi

  if ! is_retryable "$code" && [[ "$code" != "6" ]]; then
    echo "[retry] unknown exit $code — stopping" >&2
    exit "$code"
  fi

  attempt=$((attempt + 1))
  if (( attempt >= MAX_TRIES )); then
    echo "[retry] exhausted $MAX_TRIES tries (last exit $code)" >&2
    exit "$code"
  fi

  delay=$(backoff_ms $((attempt - 1)))
  echo "[retry] strategy=$STRATEGY exit=$code — attempt $((attempt + 1))/$MAX_TRIES after ${delay}ms" >&2
  sleep "$(awk "BEGIN { printf \"%.3f\", $delay/1000 }")"
done

exit 1
