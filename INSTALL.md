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

Config: `~/.xclaw/xclaw.json`

## Production

```bash
export XCLAW_PROFILE=prod
export XCLAW_GATEWAY_TOKEN="$(openssl rand -hex 32)"
bash install/install.sh --yes --profile prod
node bin/xclaw.mjs gateway
```

## Troubleshooting

| Symptom | Try |
|---------|-----|
| Node too old | Install Node 22+ from nodejs.org |
| No API key | `export XAI_API_KEY=...` then re-run install |
| Docker WebChat down | Port **18790**; host `0.0.0.0` inside container |
| Prove script fails | `XCLAW_E2E_PORT=18791 npm run prove:install` |
