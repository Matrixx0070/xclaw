#!/usr/bin/env bash
# XClaw gateway health watchdog (P3.6)
set -euo pipefail
PORT="${XCLAW_SERVER_PORT:-4243}"
URL="${XCLAW_HEALTH_URL:-http://127.0.0.1:${PORT}/ready}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if curl -fsS -m 5 "$URL" >/dev/null 2>&1; then
  exit 0
fi
echo "$(date -Is) XClaw unhealthy at $URL — restarting"
# Prefer systemd if available
if command -v systemctl >/dev/null 2>&1 && systemctl is-enabled xclaw >/dev/null 2>&1; then
  systemctl restart xclaw || true
  exit 0
fi
# Fallback: start gateway in background
cd "$ROOT"
nohup node bin/xclaw.mjs gateway >>/tmp/xclaw-gateway.log 2>&1 &
echo $! >/tmp/xclaw-gateway.pid
