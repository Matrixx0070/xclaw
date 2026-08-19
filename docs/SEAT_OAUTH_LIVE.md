# Seat OAuth live refresh against xAI

## Goal

Production-grade refresh with reuse detection against real `https://auth.x.ai/oauth/token`.

## Flow

1. Lab: provider login obtains refresh_token
2. Runtime: `src/auth/xai.mjs` `refreshOAuthToken` calls `recordRefreshUse`
3. On reuse → throw; doctor surfaces registry
4. Prod: require stop HMAC + oauth registry present

## Verify

```bash
node --test test/oauth-rotation.test.mjs
```
