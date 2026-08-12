#!/usr/bin/env bash
# XClaw R6 — macOS / Linux / WSL install helper
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

# Optional: copy sample env
if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "[xclaw] wrote .env from example — add XAI_API_KEY"
fi

echo ""
echo "Next:"
echo "  export XAI_API_KEY=xai-..."
echo "  node bin/xclaw.mjs doctor"
echo "  node bin/xclaw.mjs gateway"
echo "  open http://127.0.0.1:18790/chat/"
echo ""
echo "Or:  node bin/xclaw.mjs gateway"
