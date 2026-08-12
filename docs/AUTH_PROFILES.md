# Auth profiles (Phase 1)

OpenClaw-style **credential sink** for XClaw.

## Storage

```
~/.xclaw/agents/<agentId>/auth-profiles.json
```

Default agent id: `main` (override with `XCLAW_AGENT_ID` or `cfg.agent.id`).

Modes:

| mode | Fields | Use |
|------|--------|-----|
| `api_key` | `apiKey` | Recommended for production |
| `token` | `token` | Anthropic-style setup-token paste |
| `oauth` | `accessToken`, `refreshToken`, `expiresAt` | PKCE / OIDC when configured |

## Resolve order

1. `cfg.agent.apiKey`
2. Ordered auth profiles for the provider
3. Environment (`XAI_API_KEY`, `OPENAI_API_KEY`, …)
4. Legacy `~/.xclaw/credentials.json`
5. `~/.grok/auth.json` (xAI only)

## CLI

```bash
xclaw models status
xclaw models auth status --provider xai
xclaw models auth list --provider xai
xclaw models auth login --provider xai --method api-key --api-key xai-...
xclaw models auth login --provider anthropic --method token --token ...
xclaw models auth order --provider xai xai:work xai:default
xclaw models auth resolve --provider xai
xclaw models auth logout --profile-id xai:default

# legacy alias still works
xclaw auth login --api-key xai-...
```

## Multiple accounts

```bash
xclaw models auth login --provider xai --name work --api-key xai-work-...
xclaw models auth login --provider xai --name personal --api-key xai-home-...
xclaw models auth order --provider xai xai:work xai:personal
```

OAuth refresh uses a file lock on `auth-profiles.json` to avoid lost updates.


OAuth policy: [OAUTH.md](./OAUTH.md)
