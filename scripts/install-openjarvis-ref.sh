#!/usr/bin/env bash
# Reference install of OpenJarvis for studying live voice patterns.
# Does NOT replace XClaw. Run on a real host (not required for XClaw core).
set -euo pipefail
echo "Installing OpenJarvis (reference) via official installer…"
echo "Source: https://github.com/open-jarvis/OpenJarvis"
curl -fsSL https://open-jarvis.github.io/OpenJarvis/install.sh | bash
echo "Try: jarvis · jarvis doctor · jarvis init --preset chat-simple"
echo "Voice-related: morning-digest presets, desktop extra, docs Voice/Live"
