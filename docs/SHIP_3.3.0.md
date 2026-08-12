# XClaw 3.3.0 ship notes

**Date:** 2026-08-06  
**Artifact:** `/home/workdir/artifacts/XCLAW_RELEASE_v3.3.0.zip`

## Checks

| Check | Result |
|-------|--------|
| Vault / OAuth / gateway unit packs (15) | **PASS** |
| `eval:regression` | **PASS** |
| Release zip | **Built** |

## What’s in 3.3 (P6) + prior

| Band | Highlights |
|------|------------|
| P0–P4 | Tools, media, channels, auth/TLS, CI seeds, Docker |
| P5 | OAuth refresh, errors, retry, scheduler, logout, encrypted store, gateway callback |
| **P6** | **Multi-user vault, Slack Socket Mode + backoff, GH Actions, docker:publish** |

## Operator smoke

```bash
unzip XCLAW_RELEASE_v3.3.0.zip && cd xclaw
export XAI_API_KEY=...
export XCLAW_GATEWAY_TOKEN=...
# optional vault encryption
export XCLAW_TOKEN_STORE_KEY=...

node bin/xclaw.mjs gateway
# Gateway default UI port often :18790 — computer :4243
curl -fsS http://127.0.0.1:18790/ready

xclaw auth connected vault list-users
npm run eval:regression
npm run docker:publish   # if docker available
```

## Docs

- `docs/PHASES_P0_P4.md`, `docs/PHASE_P5.md`, `docs/PHASE_P6.md`
- `docs/OAUTH_BROWSER.md`, `TOKEN_REFRESH.md`, `OAUTH_ERROR_HANDLING.md`, `OAUTH_RETRY.md`
