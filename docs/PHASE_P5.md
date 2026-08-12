# Phase P5 — OAuth ops polish (v3.2.0)

| Item | Status |
|------|--------|
| Proactive refresh scheduler | `startRefreshScheduler` on gateway start |
| Connected logout | `xclaw auth connected logout [app\|all]` |
| Doctor token expiry | `connected.tokens.*` checks |
| Gateway OAuth callback | `GET /oauth/callback` + `/auth/callback` |
| Token store encryption | AES-256-GCM when `XCLAW_TOKEN_STORE_KEY` set |
| Mock refresh tests | `test/token-refresh-mock.test.mjs` |

## CLI

```bash
xclaw auth connected logout github
xclaw auth connected logout all
xclaw doctor --json   # connected.tokens.*
```

## Encryption

```bash
export XCLAW_TOKEN_STORE_KEY='long-random-secret'
# tokens rewritten encrypted on next saveTokens
```

## Scheduler

```json
"connected": {
  "refreshScheduler": true,
  "refreshIntervalMs": 900000
}
```

Env: `XCLAW_TOKEN_REFRESH_INTERVAL_MS`

## Gateway callback

Register provider redirect as:

`http://127.0.0.1:<gatewayPort>/oauth/callback`

CLI still uses its own loopback by default; pending helper enables gateway-assisted exchange.
