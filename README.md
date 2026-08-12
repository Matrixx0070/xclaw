# XClaw

**Self-hosted multi-LLM agent gateway** with a real computer (bash / files / browser tools), swarm + receipts, and production-minded guards.

Not a thin chat wrapper: agents **run tools**, can **verify work**, and can **prove** outcomes with evals—not just talk.

> Honest scope: competitive with serious open agent platforms. Not “one year ahead of the entire industry.”

---

## 15-minute start

```bash
git clone https://github.com/Matrixx0070/xclaw.git
cd xclaw

# 0) One-command install + onboard (creates ~/.xclaw, runs doctor)
XAI_API_KEY=xai-... npm run install:local     # or: bash install/install.sh --yes
# equivalently, just onboard:  npm run onboard -- --yes --profile lab

# 1) Key (never commit this)
export XAI_API_KEY=xai-...          # or other provider keys via config
export XCLAW_PROFILE=lab            # convenient defaults
export XCLAW_MODEL=xai/grok-4.5

# 2) Health
node bin/xclaw.mjs doctor          # exit 0=ok · 1=warnings · 2=errors
node bin/xclaw.mjs status --json

# 3) One-shot goal
node bin/xclaw.mjs agent "Create /tmp/xclaw-hello.txt with text ok"

# Optional: long-running gateway + WebChat
node bin/xclaw.mjs gateway
# → http://127.0.0.1:18790/chat/
```

| Check | Expect |
|-------|--------|
| `doctor` | Config loads; lab profile OK; warns if no API key |
| `agent "…"` | Tool runs (lab auto-approves) or clear error |
| Computer | Thin native server on `:4243` (auto-start) |

**Requirements:** Node.js **≥ 22**, network for model APIs.

Config file: `~/.xclaw/xclaw.json` (created on first run).

More install detail: [INSTALL.md](./INSTALL.md)

---

## Secrets

- **Never commit** API keys, OAuth tokens, or GitHub PATs.
- Prefer env vars or local config outside the repo.
- If a key was pasted into chat or logs → **rotate it**.
- Prod: set `XCLAW_GATEWAY_TOKEN` (or `gateway.token` in config).

---

## Profiles

| Profile | Intent | Typical defaults |
|---------|--------|------------------|
| **lab** | Local experiments | `autoApprove=true`, egress allow, open gateway |
| **dev** | Day-to-day build | Mixed; prefer explicit approvals for risky tools |
| **prod** | Exposed or unattended | Token required, stricter approvals, egress **deny**, prefer OS sandbox |

```bash
export XCLAW_PROFILE=lab    # default-friendly
export XCLAW_PROFILE=prod
export XCLAW_GATEWAY_TOKEN=$(openssl rand -hex 32)
```

| Knob | Env / config | Notes |
|------|----------------|-------|
| Egress | `XCLAW_EGRESS=deny\|allow\|allowlist` | Prod default deny for shell network patterns |
| OS sandbox | `XCLAW_OS_SANDBOX=auto\|bwrap\|off` | Uses **bubblewrap** when installed & usable |
| Spawn plan | `XCLAW_SPAWN_ENFORCE` | Exact approved command at bash spawn |
| Kill | `xclaw stop-all` | Abort sessions + stop computer |

Project memory injected into the agent: **[XCLAW.md](./XCLAW.md)** (edit this for repo-local rules).

---

## Strategy C (computer)

**Modules are the source of truth.** Do **not** hand-edit the ~16MB `xclaw-server.mjs` bundle.

| Engine | Entry | When |
|--------|--------|------|
| **native** (default) | `src/computer/thin-server.mjs` | Fast lab; edit `src/computer/modules/**` |
| **generated** | `src/computer/generated/computer-server.mjs` | `npm run build:computer` |
| **bundle** | `src/computer/xclaw-server.mjs` | Full CDP — treat as **runtime artifact** |

```bash
npm run build:computer
# XCLAW_COMPUTER_ENGINE=native|generated|bundle
```

Policy: [src/computer/STRATEGY_C.md](./src/computer/STRATEGY_C.md)

---

## Docker (try-me)

```bash
cd deploy
cp env.example .env   # set XAI_API_KEY
docker compose up --build
# → http://127.0.0.1:18790/chat/
```

Publishes **18790** (gateway / WebChat) and **4243** (computer). See [INSTALL.md](./INSTALL.md#docker-try-me).

## What you get

| Area | Capability |
|------|------------|
| **Agent** | Multi-provider loop, tools, loop guards, role routing, transcripts |
| **Computer** | Bash / files / browser (native); optional full CDP bundle |
| **Security** | Approvals, plan binding + spawn enforce, egress, optional bwrap, kill-switch |
| **Swarm** | DAG, receipts, merge policy (prod should not silent-auto-merge) |
| **Ops** | `/health`, `/ready`, doctor, CI unit / media / sandbox |

---

## Common commands

```bash
node bin/xclaw.mjs doctor
node bin/xclaw.mjs status
node bin/xclaw.mjs agent "your goal"
node bin/xclaw.mjs gateway
node bin/xclaw.mjs stop-all
node bin/xclaw.mjs automations list
node bin/xclaw.mjs sessions-active
node bin/xclaw.mjs transcripts list

node --test test/spawn-enforce.test.mjs test/os-sandbox.test.mjs
npm run release-gate:quick
```

| Surface | Default URL |
|---------|-------------|
| Gateway | http://127.0.0.1:18790 |
| WebChat | http://127.0.0.1:18790/chat/ |
| Computer | http://127.0.0.1:4243 |

---

## Production sketch

```bash
export XCLAW_PROFILE=prod
export XCLAW_GATEWAY_TOKEN=long-random-secret
# Linux: apt install bubblewrap   # OS sandbox for bash when usable

# Docker
cd deploy && cp env.example .env   # set token + key + PROFILE=prod
docker compose up -d --build
```

See [OPS.md](./OPS.md) and `deploy/`.

---

## Docs map (start here)

| Doc | Topic |
|-----|--------|
| **This README** | Entry path, profiles, secrets, Strategy C |
| [XCLAW.md](./XCLAW.md) | Project notes auto-injected into the agent |
| [INSTALL.md](./INSTALL.md) | Install, verify, troubleshooting |
| [OPS.md](./OPS.md) | Operations, runtime |
| [CHANGELOG.md](./CHANGELOG.md) | Version history |
| [src/computer/STRATEGY_C.md](./src/computer/STRATEGY_C.md) | Computer source vs runtime |
| [docs/API.md](./docs/API.md) | HTTP / gateway API |
| [docs/APPROVALS.md](./docs/APPROVALS.md) | Approval / plan binding |
| [docs/BROWSER_UNBUNDLE.md](./docs/BROWSER_UNBUNDLE.md) | Native browser vs CDP |
| [docs/](./docs/) | Auth, swarm, eval notes (many specialized) |

Deep / historical design notes live under `docs/`—prefer this README + XCLAW.md for daily use.

---

## License

MIT — see [THIRD_PARTY.md](./THIRD_PARTY.md) for bundled components.
