# XClaw install guide

## One-command install (recommended)

```bash
git clone https://github.com/Matrixx0070/xclaw.git
cd xclaw
export XAI_API_KEY=xai-...          # optional but recommended
bash install/install.sh --yes
```

That single script:

1. Checks **Node ≥ 22**
2. Runs **`init`** (config + profile + optional API key)
3. Runs **`doctor`**
4. Prints WebChat URL

Start the gateway:

```bash
node bin/xclaw.mjs gateway
# → http://127.0.0.1:18790/chat/
```

Or install **and** start in one go:

```bash
bash install/install.sh --yes --start-gateway
```

Prove the full path (CI uses this):

```bash
npm run prove:install
# or: node scripts/prove-install-e2e.mjs
```

> **Note:** OpenClaw-style `curl | bash` from a public URL needs a public install host or public repo. While XClaw is private, the supported one-liner is **clone + `bash install/install.sh`**.

## Docker try-me

```bash
cd deploy
cp env.example .env   # set XAI_API_KEY
docker compose up --build
# → http://127.0.0.1:18790/chat/
```

## Manual steps

```bash
export XAI_API_KEY=xai-...
export XCLAW_PROFILE=lab
node src/cli/init.mjs --yes
node bin/xclaw.mjs doctor
node bin/xclaw.mjs gateway
```

| URL | Purpose |
|-----|---------|
| http://127.0.0.1:18790/chat/ | WebChat |
| http://127.0.0.1:18790/control/ | Control UI |
| http://127.0.0.1:4243/health | Computer |

Config is created at **`~/.xclaw/xclaw.json`** on first load. Default profile **lab** auto-approves tools.

### Optional installer scripts

```bash
# macOS / Linux / WSL
bash install/install.sh

# Windows PowerShell
.\install\install.ps1
```

## Docker (try-me)

All-in-one image publishes **gateway (WebChat)** and computer:

```bash
cd deploy
cp env.example .env
# edit .env — set at least XAI_API_KEY

docker compose up --build
```

Then open **http://127.0.0.1:18790/chat/**

| Host port | Service |
|-----------|---------|
| **18790** | Gateway / WebChat / Control |
| 4243 | Computer (optional direct access) |

Notes:

- Compose sets `XCLAW_GATEWAY_HOST=0.0.0.0` so published ports reach the process (profiles otherwise bind `127.0.0.1`).
- Default profile is **lab**. For stricter mode:
  ```bash
  # in .env
  XCLAW_PROFILE=prod
  XCLAW_GATEWAY_TOKEN=$(openssl rand -hex 32)
  ```
- Sidecar layout (separate computer container):  
  `docker compose -f docker-compose.sidecar.yml up --build`

Image choices:

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
export XCLAW_GATEWAY_TOKEN="$(openssl rand -hex 32)"
bash install/install.sh --yes --profile prod
node bin/xclaw.mjs gateway
```

Docker prod sketch: set `XCLAW_PROFILE=prod` and `XCLAW_GATEWAY_TOKEN` in `deploy/.env`, then `docker compose up -d --build`.

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
| Node too old | Install Node 22+ from nodejs.org |
| No API key | `export XAI_API_KEY=...` then re-run install |
| Prove script fails | `XCLAW_E2E_PORT=18791 npm run prove:install` |
| Computer not healthy | `node bin/xclaw.mjs computer` / check port **4243** |
| Tools blocked | `XCLAW_PROFILE=lab` or approval settings |
| Generated engine missing | `npm run build:computer` |
| Bundle vs thin confusion | Read STRATEGY_C — modules are source; 16MB is runtime |
| Docker WebChat unreachable | Confirm port **18790** published; host must be `0.0.0.0` inside container |
| Docker health failing | `curl -fsS http://127.0.0.1:18790/ready` inside container |

More: **OPS.md**, **docs/API.md**, **README.md**.
