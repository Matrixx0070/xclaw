# XClaw 3.4.2 ship notes

**Date:** 2026-08-08  
**Artifact:** `/home/workdir/artifacts/XCLAW_RELEASE_v3.4.2.zip`

## Checks

| Check | Result |
|-------|--------|
| Account L1–L3 + vault unit packs (12) | **PASS** |
| `eval:regression` | **PASS** |
| Release zip | **Built** |

## Highlights since 3.3.x

| Area | Detail |
|------|--------|
| **Account linking L1** | `channel:nativeId`, `links.json`, CLI |
| **L2** | `/link` pairing codes (Slack/Telegram/Discord/WebChat) |
| **L3** | Vault merge on link (per-app last-write-wins, `.bak` sources) |
| Discord | `userId` on `replyWithAgent` + commands |
| Prior | P0–P6, OAuth stack, Slack Socket Mode, Grafana |

## Operator smoke

```bash
unzip XCLAW_RELEASE_v3.4.2.zip && cd xclaw
export XAI_API_KEY=... XCLAW_GATEWAY_TOKEN=...
node bin/xclaw.mjs gateway

# Account linking
xclaw auth accounts list
# On channel A: /link
# On channel B: /link XCLAW-XXXX
xclaw auth accounts migrate acc_...   # optional re-merge
```

## Docs

- `docs/ACCOUNT_LINKING.md`
- `docs/PHASE_P5.md`, `PHASE_P6.md`, `SLACK_SOCKET_MODE.md`
