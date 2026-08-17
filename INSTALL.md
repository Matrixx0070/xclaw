# XClaw install guide

## Requirements

- **Node.js ≥ 22** (22 LTS or 24+)
- API key for live agent runs:
  - `XAI_API_KEY` and/or provider keys in `~/.xclaw/xclaw.json`
- Optional: Git for swarm worktree flows

## Install from GitHub

```bash
git clone https://github.com/Matrixx0070/xclaw.git
cd xclaw
git checkout v3.77.1   # or main

# core is pure ESM; install only if you need optional deps / scripts
npm install   # safe to run

export XAI_API_KEY=xai-...
export XCLAW_PROFILE=lab
export XCLAW_MODEL=xai/grok-4.5

node bin/xclaw.mjs doctor
node bin/xclaw.mjs self-test
node bin/xclaw.mjs gateway
```

Docs: [SECURITY.md](./SECURITY.md) · [docs/AUTONOMY.md](./docs/AUTONOMY.md) · [docs/FABRIC.md](./docs/FABRIC.md) · [CHANGELOG.md](./CHANGELOG.md)

| URL | Purpose |
|-----|---------|
| http://127.0.0.1:18790/chat/ | WebChat |
| http://127.0.0.1:18790/control/ | Control UI |
| http://127.0.0.1:4243/health | Computer (auto-start) |

Config is created at **`~/.xclaw/xclaw.json`** on first load. Default profile **lab** auto-approves tools.

### Optional installer scripts

```bash
# macOS / Linux / WSL
bash install/install.sh

# Windows PowerShell
.\install\install.ps1
```

## One-shot agent

```bash
node bin/xclaw.mjs agent "List files in the current directory"
```

## Computer engines

Default lab engine is **native** (thin server).

```bash
# Build modules → generated/computer-server.mjs (does not overwrite 16MB CDP bundle)
npm run build:computer

XCLAW_COMPUTER_ENGINE=native      # thin-server.mjs (default)
XCLAW_COMPUTER_ENGINE=generated   # esbuild artifact
XCLAW_COMPUTER_ENGINE=bundle      # full xclaw-server.mjs (~16MB CDP)
```

See [src/computer/STRATEGY_C.md](./src/computer/STRATEGY_C.md).

## Verify

```bash
node bin/xclaw.mjs doctor
node bin/xclaw.mjs status
curl -s http://127.0.0.1:18790/health
curl -s http://127.0.0.1:4243/health

node --test test/computer-strategy-c.test.mjs test/computer-c3-generated.test.mjs
```

Live soak (API key required):

```bash
node scripts/soak-agent.mjs 3
```

## Production

```bash
export XCLAW_PROFILE=prod
export XCLAW_AUTONOMY_LEVEL=supervised   # optional; prod hardens to supervised anyway
export XCLAW_GATEWAY_TOKEN="$(openssl rand -hex 32)"
# Optional multi-agent browser safety:
# export XCLAW_COMMIT_GATES=1
# export XCLAW_FABRIC_ENFORCE=1
node bin/xclaw.mjs doctor   # expect skills.install gated, autoApprove false
node bin/xclaw.mjs gateway
```

Load-time prod hardening prevents lab `autoApprove` from leaking via a shared config file. See [SECURITY.md](./SECURITY.md).

Docker: `cd deploy && docker compose up -d --build`

## Swarm data dirs

| Path | Content |
|------|---------|
| `~/.xclaw/swarms/agents/` | Subagent snapshots |
| `~/.xclaw/swarms/runs/` | Swarm run records |

## Optional: mitmproxy

```bash
pip install --user mitmproxy
export XCLAW_MITM=true
# lab only until CA trusted:
export XCLAW_MITM_INSECURE_CERTS=1
```

See **OPS.md** and **docs/MITM_SCRIPTING.md**.

## Troubleshooting

| Symptom | Try |
|---------|-----|
| Computer not healthy | `node bin/xclaw.mjs computer` / check port **4243** |
| Tools blocked | `XCLAW_PROFILE=lab` or approval settings |
| Generated engine missing | `npm run build:computer` |
| Bundle vs thin confusion | Read STRATEGY_C — modules are source; 16MB is runtime |

More: **OPS.md**, **docs/API.md**, **README.md**.
