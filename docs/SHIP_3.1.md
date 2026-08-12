# XClaw 3.1.0 ship notes

**Date:** 2026-08-06  
**Artifact:** `/home/workdir/artifacts/XCLAW_RELEASE_v3.1.0.zip` (~4.6 MB)

## Pre-ship checks

| Check | Result |
|-------|--------|
| `npm run eval:regression` | PASS (unit packs) |
| `xclaw doctor` | WARN without live gateway/API key (expected on ephemeral sandbox) |
| Release zip | Built (excludes node_modules, XSD schemas, temp images) |

## What shipped (P0–P4)

Full itemization: **[PHASES_P0_P4.md](./PHASES_P0_P4.md)**

| Version | Band |
|---------|------|
| 2.7.0 | P0 Foundation (Office trees, browser shot/snap, Telegram media, LO UNO) |
| 2.8.0 | P1 Media (video, images, vision) |
| 2.9.0 | P2 Channels (Slack, Email, Discord attach, templates) |
| 3.0.0 | P3 Platform (connected apps, artifacts, persistence) |
| **3.1.0** | **P4 Publish (auth/TLS, Socket Mode, imagine matrix, CI, Docker)** |

## Operator smoke

```bash
unzip XCLAW_RELEASE_v3.1.0.zip && cd xclaw
export XAI_API_KEY=...
export XCLAW_GATEWAY_TOKEN=...
node bin/xclaw.mjs gateway
curl -fsS http://127.0.0.1:4243/ready
curl -fsS -H "Authorization: Bearer $XCLAW_GATEWAY_TOKEN" http://127.0.0.1:4243/version
node bin/xclaw.mjs doctor
npm run eval:regression
```

## Config checklist

| Concern | Key |
|---------|-----|
| Model | `XAI_API_KEY` / `agent.model` |
| Gateway auth | `XCLAW_GATEWAY_TOKEN` |
| TLS | `XCLAW_TLS_CERT`, `XCLAW_TLS_KEY` |
| Telegram | `TELEGRAM_BOT_TOKEN` + `channels.telegram.enabled` |
| Slack | `SLACK_BOT_TOKEN` + optional `SLACK_APP_TOKEN` |
| Email | `EMAIL_IMAP_*`, `EMAIL_SMTP_*` |
| GitHub connected | `GITHUB_TOKEN` |
| Image search | `BING_SEARCH_KEY` or `SERPAPI_API_KEY` |
| X API | `X_BEARER_TOKEN` |
| LO UNO | `XCLAW_LO_UNO_URL`, `XCLAW_LO_USER_INSTALLATION` |
| Image models | `XCLAW_IMAGE_MODELS` |

## Docker

```bash
docker build -t xclaw:3.1.0 .
docker run --rm -p 4243:4243 -e XAI_API_KEY -e XCLAW_GATEWAY_TOKEN xclaw:3.1.0
```
