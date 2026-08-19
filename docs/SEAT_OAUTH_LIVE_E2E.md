# Live xAI seat OAuth E2E (lab)

## Steps

1. `XCLAW_PROFILE=lab` with valid xAI OAuth client + refresh token on disk
2. Force near-expiry access token
3. Trigger provider call → `refreshOAuthToken` → `recordRefreshUse`
4. Replay same refresh token → must throw `refresh_token_reuse`
5. Doctor `auth.oauthRefreshRegistry` shows retired count ≥ 1

## Offline stand-in

```bash
node --test test/oauth-rotation.test.mjs test/autonomy-offline-gate.test.mjs
```
