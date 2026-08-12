# OAuth retry logic

## Defaults

| Setting | Default | Env |
|---------|---------|-----|
| retries | 3 | `XCLAW_OAUTH_RETRIES` |
| baseMs | 300 | `XCLAW_OAUTH_RETRY_BASE_MS` |
| maxDelayMs | 15000 | `XCLAW_OAUTH_RETRY_MAX_MS` |
| strategy | **decorrelated** jitter | `XCLAW_OAUTH_JITTER` |
| Retry-After | respected | — |

Log retries: `XCLAW_OAUTH_RETRY_LOG=1`

## What is retried

| Yes | No |
|-----|-----|
| `token_network` / `refresh_network` | `refresh_invalid` (reauth) |
| HTTP **429** / **408** / **5xx** | `state_mismatch`, `provider_denied` |
| Transient `token_http` / `refresh_http` | `missing_config`, `no_token`, `token_no_access` |

## Where applied

1. **Authorization code → token exchange** (`browserAuthorizationCodePkce`)
2. **Refresh token grant** (`refreshAccessToken`)
3. Shared helper: `src/auth/oauth-retry.mjs` → `withOAuthRetry`

## Disable

```js
await refreshAccessToken({ ..., retry: false });
await browserAuthorizationCodePkce({ ..., retry: false });
```

## Algorithm

Uses `withBackoff` from `src/utils/backoff.mjs`:

1. Attempt call
2. If `{ ok:false, retryable }` or transient throw → sleep (jitter / Retry-After)
3. Repeat until success or retries exhausted
4. On exhaust, return last structured error with `retriesExhausted: true`
