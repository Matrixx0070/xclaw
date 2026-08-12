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

# Optional project .env for local docker/dev
if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "[xclaw] wrote .env from example — add XAI_API_KEY if needed"
fi
if [ ! -f deploy/.env ] && [ -f deploy/env.example ]; then
  cp deploy/env.example deploy/.env
  echo "[xclaw] wrote deploy/.env from env.example"
fi

# First-run config + optional API key from environment
INIT_ARGS=(--yes)
if [ -n "${XCLAW_PROFILE:-}" ]; then
  INIT_ARGS+=(--profile "$XCLAW_PROFILE")
else
  INIT_ARGS+=(--profile lab)
fi
if [ -n "${XCLAW_MODEL:-}" ]; then
  INIT_ARGS+=(--model "$XCLAW_MODEL")
fi
if [ -n "${XAI_API_KEY:-}${XCLAW_API_KEY:-}${OPENAI_API_KEY:-}" ]; then
  # Prefer explicit flag only when we have a concrete key value
  KEY="${XAI_API_KEY:-${XCLAW_API_KEY:-${OPENAI_API_KEY:-}}}"
  INIT_ARGS+=(--api-key "$KEY")
fi

echo "[xclaw] running init…"
if node bin/xclaw.mjs init "${INIT_ARGS[@]}"; then
  :
else
  # Fallback if CLI not yet wired on older checkouts
  node src/cli/init.mjs "${INIT_ARGS[@]}" || true
fi

echo ""
echo "Verify:"
echo "  node bin/xclaw.mjs doctor"
echo "  node bin/xclaw.mjs gateway"
echo "  open http://127.0.0.1:18790/chat/"
echo ""
echo "Docker try-me:"
echo "  cd deploy && cp env.example .env && docker compose up --build"
