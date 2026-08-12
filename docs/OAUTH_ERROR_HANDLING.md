# OAuth & token-refresh error handling

Stable **machine codes** + human **error** + operator **hint**.

Implementation: `src/auth/oauth-errors.mjs`

## Error shape

```json
{
  "ok": false,
  "code": "refresh_invalid",
  "error": "refresh failed — tokens cleared; re-login required: invalid_grant",
  "hint": "Refresh rejected (revoked/rotated). Tokens cleared — run connected login again.",
  "reauth": true,
  "retryable": false,
  "provider": "google",
  "httpStatus": 400,
  "detail": "invalid_grant"
}
```

| Field | Meaning |
|-------|---------|
| `code` | Stable id for logs / automation |
| `error` | Human-readable summary |
| `hint` | What to do next |
| `reauth` | Must run browser login again |
| `retryable` | Safe to retry without login |
| `httpStatus` | Upstream HTTP status when applicable |
| `provider` | `github` / `google` / … |

---

## Code catalog

### Browser authorize / callback

| Code | When | Retry? | Re-auth? |
|------|------|--------|----------|
| `missing_config` | No client id / URLs | No | — |
| `state_mismatch` | CSRF state ≠ expected | Retry login | Yes |
| `provider_denied` | User clicked deny | Retry consent | Yes |
| `callback_timeout` | No redirect in time | Retry login | — |
| `callback_port_busy` | Port in use | Change port | — |
| `missing_code` | Callback without `code` | Retry login | — |

### Token exchange

| Code | When | Retry? | Re-auth? |
|------|------|--------|----------|
| `token_network` | DNS/TCP/TLS failure | Yes | No |
| `token_http` | 4xx/5xx from token URL | Sometimes | If 401 |
| `token_no_access` | JSON missing `access_token` | No | Check app setup |

### Refresh / ensureFreshToken

| Code | When | Action |
|------|------|--------|
| `unknown_app` | Bad app id | Use `github` \| `google` |
| `no_token` | Nothing in env or store | `auth connected login` |
| `no_refresh_token` | Cannot refresh | Re-login with offline scopes |
| `no_client_id` | Missing OAuth client id env | Set `XCLAW_*_OAUTH_CLIENT_ID` |
| `expired_no_refresh` | AT expired, no RT | Re-login |
| `refresh_invalid` | `invalid_grant` / revoked / reuse | **Tokens cleared** → re-login |
| `refresh_http` | Other refresh HTTP errors | Retry; then re-login |
| `refresh_network` | Network on refresh | Retry |

---

## Handling matrix (callers)

```text
ensureFreshToken / resolveToken
  ├─ ok: true  → use accessToken
  ├─ reauth: true → prompt: xclaw auth connected login <app>
  ├─ retryable: true → backoff and retry once
  └─ else → surface error + hint to user/agent

github_request on HTTP 401
  → resolveToken({ force: true }) once
  → if still 401 → return error (likely reauth)
```

---

## Logging guidance

- Log `code`, `provider`, `httpStatus`, `reauth` — **never** access/refresh tokens.
- On `refresh_invalid`, log that store was invalidated.
- Metrics counters (optional): `oauth.refresh.success`, `oauth.refresh.invalid`, `oauth.login.timeout`.

---

## Tests

```bash
node --test test/oauth-errors.test.mjs test/token-refresh.test.mjs
```


## Retries

See [OAUTH_RETRY.md](./OAUTH_RETRY.md).
