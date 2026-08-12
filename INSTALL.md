# XClaw install guide

## Requirements

- **Node.js ≥ 22** (22 LTS or 24+)
- API key for live agent runs:
  - `XAI_API_KEY` and/or provider keys stored via `init` / auth profiles
- Optional: Git for swarm worktree flows

## Install from GitHub (recommended)

```bash
git clone https://github.com/Matrixx0070/xclaw.git
cd xclaw

# optional: npm install if you need package scripts / global bin
npm install

# First-run setup (creates ~/.xclaw, stores key, sets profile)
export XAI_API_KEY=xai-...
npm run init -- --yes --profile lab --model xai/grok-4.5
# equivalent: node src/cli/init.mjs --yes --api-key "$XAI_API_KEY"

node bin/xclaw.mjs doctor
node bin/xclaw.mjs gateway
```

| URL | Purpose |
|-----|---------|
| http://127.0.0.1:18790/chat/ | WebChat |
| http://127.0.0.1:18790/control/ | Control UI |
| http://127.0.0.1:4243/health | Computer (auto-start) |

Config: **`~/.xclaw/xclaw.json`**. Default profile **lab** auto-approves tools.

### Installer scripts

```bash
# macOS / Linux / WSL — runs node version check + init
export XAI_API_KEY=xai-...
bash install/install.sh

# Windows PowerShell
$env:XAI_API_KEY="xai-..."
.\install\install.ps1
```

### `init` options

```bash
node src/cli/init.mjs --help

# Non-interactive
node src/cli/init.mjs --yes --profile lab --api-key "$XAI_API_KEY"
node src/cli/init.mjs --yes --provider openai --api-key "$OPENAI_API_KEY" --model openai/gpt-4o-mini

# Interactive (TTY)
node src/cli/init.mjs
```

Also available as `npm run init` / `npx xclaw-init` after install.

## Docker (try-me)

```bash
cd deploy
cp env.example .env
# edit .env — set at least XAI_API_KEY

docker compose up --build
```

Open **http://127.0.0.1:18790/chat/**

| Host port | Service |
|-----------|---------|
| **18790** | Gateway / WebChat / Control |
| 4243 | Computer (optional direct access) |

Notes:

- Compose forces `XCLAW_GATEWAY_HOST=0.0.0.0` so published ports work.
- Default profile **lab**. For prod: set `XCLAW_PROFILE=prod` and `XCLAW_GATEWAY_TOKEN` in `.env`.
- Sidecar: `docker compose -f docker-compose.sidecar.yml up --build`

| Dockerfile | Use |
|------------|-----|
| `deploy/Dockerfile` | Production-slim (compose default) |
| root `Dockerfile` | Lab image with office/OCR tooling |

## One-shot agent

```bash
node bin/xclaw.mjs agent "List files in the current directory"
```

## Computer engines

Default lab engine is **native** (thin server).

```bash
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
```

## Production

```bash
export XCLAW_PROFILE=prod
export XCLAW_GATEWAY_TOKEN="$(openssl rand -hex 32)"
node bin/xclaw.mjs gateway
```

Docker: set `XCLAW_PROFILE=prod` and `XCLAW_GATEWAY_TOKEN` in `deploy/.env`, then `docker compose up -d --build`.

## Troubleshooting

| Symptom | Try |
|---------|-----|
| No API key | `npm run init -- --yes --api-key xai-...` or export `XAI_API_KEY` |
| Computer not healthy | `node bin/xclaw.mjs computer` / port **4243** |
| Tools blocked | `XCLAW_PROFILE=lab` or approval settings |
| Docker WebChat unreachable | Port **18790** published; host `0.0.0.0` inside container |
| Docker health failing | `curl -fsS http://127.0.0.1:18790/ready` inside container |

More: **OPS.md**, **docs/API.md**, **README.md**.
