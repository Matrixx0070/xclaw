# Production seat OAuth live canary

## Cadence

- Lab: hourly refresh probe (non-prod credentials)
- Prod: daily canary with dedicated seat, alert on reuse or refresh failure

## Probe

1. Load refresh token for canary seat
2. Call token endpoint once → success, registry records id
3. Call again with same token → must fail closed (`refresh_token_reuse`)
4. Doctor `auth.oauthRefreshRegistry` status error in prod if reused flag set
5. Pager / log: `event=oauth_refresh_reuse`

## Offline

```bash
node --test test/oauth-rotation.test.mjs
```
