# XClaw install guide

## Requirements

- **Node.js >= 22**
- API key (optional for doctor/tests; required for live chat)
  - `XAI_API_KEY` or `XCLAW_API_KEY` / `OPENAI_API_KEY`

## Quick install (R6)

### macOS / Linux / WSL

```bash
# from the xclaw tree (unzip or clone)
bash install/install.sh
export XAI_API_KEY=xai-...
node bin/xclaw.mjs doctor
node bin/xclaw.mjs gateway
```

WebChat: http://127.0.0.1:18790/chat/

### Windows (PowerShell)

```powershell
.\install\install.ps1
$env:XAI_API_KEY="xai-..."
node bin\xclaw.mjs doctor
node bin\xclaw.mjs gateway
```

### From release zip

```bash
unzip XCLAW_RELEASE_v3.7.0.zip
cd xclaw
bash install/install.sh   # or install.ps1 on Windows
```

## Minimal runtime

| Service | Default |
|---------|---------|
| Gateway | `http://127.0.0.1:18790` |
| WebChat | `http://127.0.0.1:18790/chat/` |
| Computer | `:4243` (auto-start) |

Config: `~/.xclaw/xclaw.json` (created on first load). Default profile **lab** (auto-approve tools).

## Verify (proof checklist)

```bash
node bin/xclaw.mjs doctor          # exit 0 or 1 (warn only)
curl -s http://127.0.0.1:18790/health
node --test test/r1*.mjs test/r2*.mjs test/r3*.mjs test/r4*.mjs test/r5*.mjs test/s0*.mjs 2>/dev/null || true
```

Optional soak:

```bash
node scripts/soak-r1.mjs --hours 1 --interval 60
```

## Production

```bash
export XCLAW_PROFILE=prod
export XCLAW_GATEWAY_TOKEN=long-random-secret
```

## Troubleshooting

See **INSTALL.md → Troubleshooting: config overrides** (profile / autoApprove).

## Swarm (S0 foundations)

Subagent snapshots: `~/.xclaw/swarms/agents/`  
Swarm runs: `~/.xclaw/swarms/runs/`  
Doctor checks: `swarm.agents`, `swarm.persisted`, `swarm.runs`


## Optional: mitmproxy (MITM)

```bash
pip install --user mitmproxy
# ensure ~/.local/bin is on PATH, or:
export XCLAW_MITMDUMP=$HOME/.local/bin/mitmdump

export XCLAW_MITM=true
# lab until CA exists on first run:
export XCLAW_MITM_INSECURE_CERTS=1
```

See OPS.md § MITM and docs/MITM_SCRIPTING.md.
