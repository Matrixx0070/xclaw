# Token refresh logic

## Behavior

1. **`resolveToken(cfg, appId)`** (connected catalog) calls **`ensureFreshToken`**.
2. Env PATs (`GITHUB_TOKEN`, etc.) win and skip refresh.
3. If stored token has `expiresAt` within **5 minutes** (skew) and a `refreshToken` exists → refresh.
4. **Single-flight**: concurrent callers for the same app share one refresh promise.
5. **Rotation**: if provider returns a new `refresh_token`, it replaces the old one.
6. **Invalid grant / reuse**: store entry is **invalidated** (tokens cleared); caller must re-login.
7. **Optimistic `updatedAt`**: if another writer refreshed first, use the winner’s token.
8. **HTTP 401** on `github_request`: one force-refresh + retry.

## API

```js
import { ensureFreshToken, refreshAppToken, isTokenExpired } from "./token-refresh.mjs";

await ensureFreshToken(cfg, "google");          // auto if near expiry
await refreshAppToken(cfg, "google", { force: true }); // CLI refresh
```

CLI:

```bash
xclaw auth connected refresh google
xclaw auth connected status
```

## Files

- `src/connected/token-refresh.mjs`
- `src/auth/oauth-browser.mjs` → `refreshAccessToken`
- `src/connected/oauth-login.mjs` → CLI refresh
- `src/connected/catalog.mjs` → `resolveToken`


## Errors

See [OAUTH_ERROR_HANDLING.md](./OAUTH_ERROR_HANDLING.md).
