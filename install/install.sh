#!/usr/bin/env bash
# XClaw one-command installer (repo-local / post-clone)
#
# Usage (from cloned repo):
#   bash install/install.sh
#   bash install/install.sh --start-gateway
#   XAI_API_KEY=xai-... bash install/install.sh --yes
#
# OpenClaw-style remote install requires a public install host or public repo.
# While the repo is private, the supported one-liner is:
#   git clone <repo> && cd xclaw && bash install/install.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

YES=0
START_GATEWAY=0
SKIP_DOCTOR=0
PROFILE="${XCLAW_PROFILE:-lab}"
MODEL="${XCLAW_MODEL:-}"
API_KEY="${XAI_API_KEY:-${XCLAW_API_KEY:-${OPENAI_API_KEY:-}}}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) YES=1; shift ;;
    --start-gateway|--start) START_GATEWAY=1; shift ;;
    --skip-doctor) SKIP_DOCTOR=1; shift ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --api-key) API_KEY="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

echo "[xclaw] install root=$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "[xclaw] Node.js >= 22 required. Install from https://nodejs.org" >&2
  exit 1
fi
MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$MAJOR" -lt 22 ]]; then
  echo "[xclaw] Node $MAJOR detected — need >= 22" >&2
  exit 1
fi
echo "[xclaw] node=$(node -v)"

if [[ ! -f package.json ]]; then
  echo "[xclaw] package.json missing — run from an xclaw checkout" >&2
  exit 1
fi

# Optional npm install (core is pure ESM; still safe)
if [[ -f package-lock.json ]] || [[ -f npm-shrinkwrap.json ]]; then
  echo "[xclaw] npm install…"
  npm install --no-fund --no-audit
elif [[ -f package.json ]]; then
  # No lockfile — skip heavy install; pure ESM runtime does not require node_modules
  echo "[xclaw] pure ESM layout — skipping npm install"
fi

if [[ ! -f .env ]] && [[ -f .env.example ]]; then
  cp .env.example .env
  echo "[xclaw] wrote .env from example"
fi
if [[ ! -f deploy/.env ]] && [[ -f deploy/env.example ]]; then
  cp deploy/env.example deploy/.env
  echo "[xclaw] wrote deploy/.env from example"
fi

INIT_ARGS=(--yes --profile "$PROFILE")
if [[ -n "$MODEL" ]]; then
  INIT_ARGS+=(--model "$MODEL")
fi
if [[ -n "$API_KEY" ]]; then
  INIT_ARGS+=(--api-key "$API_KEY")
fi
if [[ "$SKIP_DOCTOR" -eq 1 ]]; then
  INIT_ARGS+=(--skip-doctor)
fi

echo "[xclaw] running init…"
if [[ -f src/cli/init.mjs ]]; then
  node src/cli/init.mjs "${INIT_ARGS[@]}"
elif [[ -f bin/xclaw-entry.mjs ]]; then
  node bin/xclaw-entry.mjs init "${INIT_ARGS[@]}"
else
  echo "[xclaw] init entry missing" >&2
  exit 1
fi

if [[ "$SKIP_DOCTOR" -eq 0 ]]; then
  echo "[xclaw] doctor…"
  node bin/xclaw.mjs doctor || true
fi

echo ""
echo "[xclaw] install complete"
echo "  config:  ~/.xclaw/xclaw.json"
echo "  gateway: node bin/xclaw.mjs gateway"
echo "  webchat: http://127.0.0.1:18790/chat/"
echo ""

if [[ "$START_GATEWAY" -eq 1 ]]; then
  echo "[xclaw] starting gateway (Ctrl+C to stop)…"
  exec node bin/xclaw.mjs gateway
fi
