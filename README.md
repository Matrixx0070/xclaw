# XClaw 1.0

Personal AI assistant **gateway + computer** with verified jobs, eval harness, and ops surface.

Better measured autonomy than a thin chat wrapper: **jobs with evidence**, **eval baselines**, **queue**, **grounding**, **durable memory**.

## Golden path

```bash
# install deps (Node 20+)
cd xclaw && npm install   # if any; pure ESM, no required deps for core

# configure
export XAI_API_KEY=xai-...
export XCLAW_MODEL=grok-4.3

# start (gateway + wait for computer)
npm run dev-up
# or: node bin/xclaw.mjs gateway

xclaw info                 # version · ready · queue
xclaw computer status
xclaw doctor

# smoke autonomy
npm run eval:ci            # or: xclaw eval --tag smoke
xclaw eval --tag hard      # Phase B hard pack
```

UI: `http://127.0.0.1:18790/control/` · WebChat: `/chat/`

## What you get

| Area | Capability |
|------|------------|
| **Agent** | Tool loop, retries, truncation, grounding hard mode |
| **Jobs** | Verify scorers, evidence, queue (retry/pause/dead letter) |
| **Eval** | Suite + CI gate + baselines + spend |
| **Memory** | Durable per-workspace MEMORY.md |
| **Ops** | `/health` `/ready` `/metrics` `/dashboard` `/report` |
| **Security** | Approval policy (risky/safeAuto), optional gateway token |

## Profiles

```bash
XCLAW_PROFILE=lab    # auto-approve
XCLAW_PROFILE=prod   # risky approvals, stricter
```

## Production

```bash
# Docker
cd deploy && docker compose up -d --build

# systemd
# copy tree to /opt/xclaw, env to /etc/xclaw/env, unit deploy/xclaw.service
```

See [docs/](docs/) — PHASE_A/B/C, QUEUE, API, INSTALL.

## API freeze (1.0)

Discover routes: `xclaw routes` or `GET /routes`.  
Ops probes: **liveness** `/health` · **readiness** `/ready` · **metrics** `/metrics`.

## License

See THIRD_PARTY.md for bundled components.

## Phases P0–P4

See [docs/PHASES_P0_P4.md](docs/PHASES_P0_P4.md) for the complete gap-roadmap delivery map (v2.7–v3.1).
