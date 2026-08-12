# XClaw × xAI authentication

## Supported (public API)

xAI inference (`https://api.x.ai`) authenticates with an **API key** as a Bearer token.

```bash
# Option A — env (CI / servers)
export XAI_API_KEY=xai-...

# Option B — store in ~/.xclaw/credentials.json (mode 0600)
xclaw auth login --api-key xai-...
xclaw auth status
```

Create keys: [console.x.ai](https://console.x.ai)

## OAuth / OIDC (experimental)

There is **no documented public OAuth client** for third-party apps to mint xAI API access.
Grok CLI uses `auth.x.ai` for interactive developer sessions; enterprise can use corporate OIDC.

XClaw includes an optional **OAuth2 PKCE** flow when you configure an issuer:

```bash
export XCLAW_XAI_OAUTH_CLIENT_ID=...
export XCLAW_XAI_OAUTH_AUTH_URL=https://auth.x.ai/authorize   # override as needed
export XCLAW_XAI_OAUTH_TOKEN_URL=https://auth.x.ai/oauth/token
export XCLAW_XAI_OAUTH_SCOPES="openid profile"
xclaw auth login --oauth
```

## Token resolution order

1. `cfg.agent.apiKey`
2. `XAI_API_KEY` / `XCLAW_API_KEY` / `OPENAI_API_KEY`
3. `~/.xclaw/credentials.json` (`xaiApiKey` or OAuth `accessToken`)
4. `~/.grok/auth.json` (Grok CLI session, if present)

## Logout
```bash
xclaw auth logout
```


See also [AUTH_PROFILES.md](./AUTH_PROFILES.md) for multi-profile routing.


OAuth policy: [OAUTH.md](./OAUTH.md)
