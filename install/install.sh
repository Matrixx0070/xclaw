#!/usr/bin/env bash
# XClaw — macOS / Linux / WSL install helper
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js >= 22 required. Install from https://nodejs.org"
  exit 1
fi
MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$MAJOR" -lt 22 ]; then
  echo "Node $MAJOR detected — need >= 22"
  exit 1
fi

echo "[xclaw] root=$ROOT"
echo "[xclaw] node=$(node -v)"

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "[xclaw] wrote .env from example"
fi
if [ ! -f deploy/.env ] && [ -f deploy/env.example ]; then
  cp deploy/env.example deploy/.env
  echo "[xclaw] wrote deploy/.env from env.example"
fi

INIT_ARGS=(--yes --profile "${XCLAW_PROFILE:-lab}")
if [ -n "${XCLAW_MODEL:-}" ]; then
  INIT_ARGS+=(--model "$XCLAW_MODEL")
fi
KEY="${XAI_API_KEY:-${XCLAW_API_KEY:-${OPENAI_API_KEY:-}}}"
if [ -n "$KEY" ]; then
  INIT_ARGS+=(--api-key "$KEY")
fi

echo "[xclaw] running init…"
node src/cli/init.mjs "${INIT_ARGS[@]}"

echo ""
echo "Verify:"
echo "  node bin/xclaw.mjs doctor"
echo "  node bin/xclaw.mjs gateway"
echo "  open http://127.0.0.1:18790/chat/"
echo ""
echo "Docker try-me:"
echo "  cd deploy && docker compose up --build"
