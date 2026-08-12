# XClaw 3.5.1 ship notes

**Date:** 2026-08-08  
**Artifact:** `/home/workdir/artifacts/XCLAW_RELEASE_v3.5.1.zip`

## Checks

| Check | Result |
|-------|--------|
| Account L1–L3 + multi-channel runtime + doctor (26) | **PASS** |
| `eval:regression` | **PASS** |
| Release zip | **Built** |

## Highlights since 3.4.2

| Area | Detail |
|------|--------|
| **CL multi-channel** | `src/channels/runtime.mjs` — normalize + processInbound for TG/Slack/Discord/Email/WebChat |
| **Doctor accounts** | links, pairing codes, vault orphans, migrate hints |
| **Docs** | ACCOUNT_LINKING migrate examples, CHANNEL_RUNTIME.md |
| Prior 3.4.x | Account L1–L3, `/link` codes, vault merge |

## Operator smoke

```bash
unzip XCLAW_RELEASE_v3.5.1.zip && cd xclaw
export XAI_API_KEY=... XCLAW_GATEWAY_TOKEN=...
node bin/xclaw.mjs gateway

xclaw doctor
xclaw auth accounts list
# Channel A: /link  →  Channel B: /link XCLAW-XXXX
xclaw auth accounts migrate acc_...   # if doctor warns about identity vaults
```

## Docs

- `docs/ACCOUNT_LINKING.md`
- `docs/CHANNEL_RUNTIME.md`
- `docs/SHIP_3.5.1.md`
