# XClaw 3.1.4 ship notes

**Date:** 2026-08-06  
**Artifact:** `/home/workdir/artifacts/XCLAW_RELEASE_v3.1.4.zip`

## Checks

| Check | Result |
|-------|--------|
| OAuth unit suite (18 tests) | **PASS** |
| `eval:regression` unit packs | **PASS** |
| Package zip | **Built** |

## 3.1.x delta (since 3.1.0)

| Ver | Feature |
|-----|---------|
| 3.1.1 | OAuth browser login (PKCE) — GitHub, Google |
| 3.1.2 | Token refresh (skew, single-flight, rotation) |
| 3.1.3 | Structured OAuth errors + recovery hints |
| **3.1.4** | **Retry logic (decorrelated jitter, Retry-After)** |

## Operator smoke

```bash
unzip XCLAW_RELEASE_v3.1.4.zip && cd xclaw
export XAI_API_KEY=...
export XCLAW_GATEWAY_TOKEN=...
node bin/xclaw.mjs gateway

export XCLAW_GITHUB_OAUTH_CLIENT_ID=...
xclaw auth connected login github
xclaw auth connected status
npm run eval:regression
```

## Docs

- `docs/OAUTH_BROWSER.md`
- `docs/TOKEN_REFRESH.md`
- `docs/OAUTH_ERROR_HANDLING.md`
- `docs/OAUTH_RETRY.md`
- `docs/PHASES_P0_P4.md`
